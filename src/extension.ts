import * as vscode from 'vscode';
import * as tmp from 'tmp-promise';
import * as xml from 'xml2js';
import * as path from 'path';

interface ValgrindTaskDefinition extends vscode.TaskDefinition {
	tool?: string,
	command: string,
	leakresolution?: string,
	showleakkinds?: string[],
	undefvalueerrors?: boolean,
	trackorigins?: boolean,
	defaultsuppressions?: boolean,
}

const VALGRIND_TYPE = 'valgrind';

let diagnosticsCollection = vscode.languages.createDiagnosticCollection('valgrind');

function fileInWorkspace(pathOrUri: string | vscode.Uri) {
	return vscode.workspace.asRelativePath(pathOrUri, false) != pathOrUri;
}

function getLineRange(line: number) {
	return new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
}

function getCodeDocumentation(code: string) {
	switch (code) {
		case 'InvalidRead':
		case 'InvalidWrite':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.badrw';
		case 'UninitValue':
		case 'UninitCondition':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.uninitvals';
		case 'SyscallParam':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.bad-syscall-args';
		case 'InvalidFree':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.badfrees';
		case 'MismatchedFree':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.rudefn';
		case 'Overlap':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.overlap';
		case 'FishyValue':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.fishyvalue';
		case 'Leak_DefinitelyLost':
		case 'Leak_IndirectlyLost':
		case 'Leak_PossiblyLost':
		case 'Leak_StillReachable':
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.leaks';
		default:
			return 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.errormsgs';
	}
}

async function parseDiagnostics(pathOrUri: string | vscode.Uri) {
	if (!(pathOrUri instanceof vscode.Uri))
		pathOrUri = vscode.Uri.file(pathOrUri);

	const log = await vscode.workspace.fs.readFile(pathOrUri);
	const data = await xml.parseStringPromise(log, {
		preserveChildrenOrder: true,
		explicitChildren: true
	});

	let unknownSymbols = 0;
	let symbols = 0;

	// Array of all the errors
	// TODO: include TOOLSPECIFIC and CLIENTMSG
	let errors = data['valgrindoutput']['error'] || [];
	let diagnostics: Record<string, vscode.Diagnostic[]> = {};

	for (let error of errors) {
		// Information message can either be in form of a simple what tag or a
		// composite xwhat tag
		let message;

		// Error code
		let code;

		// Diagnostic stack trace output
		let stacktrace: vscode.DiagnosticRelatedInformation[] = [];

		// Temp variables to store the deepest frame of a file in the workspace
		// to which the diagnostic will be associated
		let lastfile: string | undefined = undefined;
		let lastfileline: number;

		// Temp auxmessage
		let auxmessage: string | undefined = undefined;

		for (let element of error['$$']) {
			switch (element['#name']) {
				case 'xwhat':
					message = element['text'][0];
					break;
				case 'what':
					message = element['_'];
					break;
				case 'kind':
					code = element['_'];
					break;
				case 'stack':
					// Frames of the stack
					let frames = element['frame'];

					for (let frame of frames) {
						// Count how many symbols are referenced
						symbols++;

						let ip = frame['ip'][0];
						// The following attributes might not be present
						let fn = frame['fn'];
						let dir = frame['dir'];
						let file = frame['file'];
						let line = frame['line'];

						if (!fn || !dir || !file || !line) {
							// Count the symbols which miss debug information
							unknownSymbols++;
							continue;
						} else {
							fn = fn[0];
							dir = dir[0];
							file = file[0];
							line = line[0];
						}

						// Full path of the file
						let fpath = path.join(dir, file)

						// Only show in the stacktrace the files that belong to the
						// workspace
						if (fileInWorkspace(fpath)) {
							stacktrace.push(
								new vscode.DiagnosticRelatedInformation(
									new vscode.Location(
										vscode.Uri.file(fpath),
										getLineRange(line - 1)
									),
									`${auxmessage ? auxmessage + ' ' : ''}at ${fn} (${ip})\n`
								)
							);

							auxmessage = undefined;

							// The first file in the workspace gets associated with the
							// diagnostic
							if (!lastfile) {
								lastfile = fpath;
								lastfileline = line;
							}
						}
					}
					break;
				case 'auxwhat':
					auxmessage = element['_'];
					break;
				case 'xauxwhat':
					auxmessage = element['text'][0];
					break;
			}
		}

		// Skip the diagnostic if it cannot be associated to a file in the
		// workspace
		if (lastfile) {
			if (!(lastfile in diagnostics)) {
				diagnostics[lastfile] = [];
			}

			let diagnostic = new vscode.Diagnostic(getLineRange(lastfileline! - 1), `${message}`);

			diagnostic.source = VALGRIND_TYPE;
			diagnostic.code = {
				value: code,
				target: vscode.Uri.parse(getCodeDocumentation(code))
			};
			diagnostic.relatedInformation = stacktrace;

			diagnostics[lastfile].push(diagnostic);
		}
	}

	diagnosticsCollection.clear();

	for (let file in diagnostics) {
		diagnosticsCollection.set(vscode.Uri.file(file), diagnostics[file]);
	}

	console.log(`Unknown symbols ratio: ${unknownSymbols / symbols}`)
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.tasks.registerTaskProvider(VALGRIND_TYPE, {
		provideTasks() {
			return undefined;
		},
		async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
			const definition: ValgrindTaskDefinition = <any>task.definition;

			if (definition.command) {
				const logfile = await tmp.tmpName();

				const execution = new vscode.ShellExecution(`valgrind`, [
					`--tool=${definition.tool || 'memcheck'}`,
					`--leak-resolution=${definition.leakresolution || 'high'}`,
					`--show-leak-kinds=${definition.showleakkinds?.join(',') || 'definite,possible'}`,
					`--undef-value-errors=${definition.undefvalueerrors || 'yes'}`,
					`--track-origins=${definition.trackorigins || 'no'}`,
					`--default-suppressions=${definition.defaultsuppressions || 'yes'}`,
					`--xml=yes`,
					`--xml-file=${logfile}`,
					`${definition.command}`
				])

				const task = new vscode.Task(
					definition,
					vscode.TaskScope.Workspace,
					"Valgrind",
					VALGRIND_TYPE,
					execution,
					""
				);

				return task;
			}

			return undefined;
		}
	}));

	context.subscriptions.push(vscode.tasks.onDidEndTask(async (event: vscode.TaskEndEvent) => {
		if (event.execution.task.definition.type == VALGRIND_TYPE) {
			// Extract logfile from command line
			const logfile = (<vscode.ShellExecution>event.execution.task.execution)?.args.filter((value) => value.toString().startsWith('--xml-file='))[0].toString().substr(11);

			await parseDiagnostics(logfile);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('valgrind.load', async () => {
		let logfile = await vscode.window.showOpenDialog({
			title: "Load a valgrind log file",
			filters: {
				"Valgrind XML log file": ["xml"]
			}
		});

		if (logfile)
			await parseDiagnostics(logfile[0]);
	}));
}

export function deactivate() {
	diagnosticsCollection.dispose()
}
