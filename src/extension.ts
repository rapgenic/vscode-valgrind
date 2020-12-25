import * as vscode from 'vscode';
import * as tmp from 'tmp-promise';
import * as xml from 'fast-xml-parser';
import * as path from 'path';

interface ValgrindTaskDefinition extends vscode.TaskDefinition {
	tool?: string,
	command: string,
	leakresolution?: string,
	showleakkinds?: string[],
	undefvalueerrors?: boolean,
	trackorigins?: boolean,
	defaultsuppressions?: boolean,
	stacktrace?: boolean
}

const VALGRIND_TYPE = 'valgrind';

let diagnosticsCollection = vscode.languages.createDiagnosticCollection('valgrind');

function fileInWorkspace(pathOrUri: string | vscode.Uri) {
	return vscode.workspace.asRelativePath(pathOrUri, false) != pathOrUri;
}

function isIterable(obj: any) {
	if (obj == null) {
		return false;
	}

	return typeof obj[Symbol.iterator] === 'function';
}

function getLineRange(line: number) {
	return new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
}

function parseCode(type: string) {
	switch (type) {
		case "InvalidFree": return "Invalid Free"
		case "MismatchedFree": return "Mismatched Free"
		case "InvalidRead": return "Invalid Read"
		case "InvalidJump": return "Invalid Jump"
		case "Overlap": return "Overlap"
		case "InvalidMemPool": return "Invalid memory pool"
		case "UninitCondition": return "Uninitialised jump"
		case "UninitValue": return "Uninitialised value"
		case "SyscallParam": return "System call parameter"
		case "ClientCheck": return "Client check"
		case "Leak_DefinitelyLost": return "Leak: definitely lost"
		case "Leak_IndirectlyLost": return "Leak: indirectly lost"
		case "Leak_PossiblyLost": return "Leak: possibly lost"
		case "Leak_StillReachable": return "Leak: still reachable"
	}
}

async function parseDiagnostics(pathOrUri: string | vscode.Uri, showStackTrace: boolean = true) {
	if (!(pathOrUri instanceof vscode.Uri))
		pathOrUri = vscode.Uri.file(pathOrUri);

	const log = await vscode.workspace.fs.readFile(pathOrUri);
	const data = xml.parse(log.toString());

	let unknownSymbols = 0;
	let symbols = 0;
	let errors = data['valgrindoutput']['error'];
	let diagnostics: Record<string, vscode.Diagnostic[]> = {};

	if (!isIterable(errors)) {
		errors = [errors];
	}

	for (let error of errors) {
		let message = 'xwhat' in error ? error['xwhat']['text'] : error['what'];
  		let stack = error['stack']['frame'];
		let code = error['kind'];
		let stacktrace: vscode.DiagnosticRelatedInformation[] = [];
		let lastfile: string | undefined = undefined;
		let lastfileline: number;

		if (!isIterable(stack)) {
			stack = [stack];
		}

		for (let frame of stack) {
			let fn = frame['fn'];
			let dir = frame['dir'];
			let file = frame['file'];
			let line = frame['line'];

			symbols++;

			if (!dir || !file || !line) {
				unknownSymbols++;
				continue;
			}

			let fpath = path.join(dir, file)

			if (fileInWorkspace(fpath)) {
				if (showStackTrace) {
					stacktrace.push(
						new vscode.DiagnosticRelatedInformation(
							new vscode.Location(
								vscode.Uri.file(fpath),
								getLineRange(line - 1)
							),
							`at ${fn} (${file}:${line})\n`
						)
					);
				}

				if (!lastfile) {
					lastfile = fpath;
					lastfileline = line;
				}
			}
		}

		if (!lastfile) {
			let frame = stack[0];
			let dir = frame['dir'];
			let file = frame['file'];
			let line = frame['line'];

			if (dir && file && line) {
				let fpath = path.join(dir, file)

				if (fileInWorkspace(fpath)) {
					lastfile = fpath;
					lastfileline = line;
				}
			}
		}

		if (lastfile) {
			if (!(lastfile in diagnostics)) {
				diagnostics[lastfile] = [];
			}

			let diagnostic = new vscode.Diagnostic(getLineRange(lastfileline! - 1), `${message}`);

			diagnostic.source = VALGRIND_TYPE;
			diagnostic.code = code;
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
			const definition: ValgrindTaskDefinition = <any>event.execution.task.definition;

			await parseDiagnostics(logfile, definition.stacktrace);
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
