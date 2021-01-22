import * as vscode from 'vscode';
import * as xml from 'xml2js';
import * as path from 'path';

import { Diagnostic, DiagnosticKind, GenericDiagnostic, LeakDiagnostic, Parser, StackTrace } from '../types';

export class ValgrindParser implements Parser {
	async parse(log: string | vscode.Uri): Promise<Diagnostic[]> {
		// Read logfile if necessary
		const raw = log instanceof vscode.Uri ? await vscode.workspace.fs.readFile(log) : log;

		// Parse XML structure
		const data = await xml.parseStringPromise(raw, {
			preserveChildrenOrder: true,
			explicitChildren: true
		});

		let unknownSymbols = 0;
		let symbols = 0;

		// Array of all the errors
		// TODO: include TOOLSPECIFIC and CLIENTMSG
		let errors = data['valgrindoutput']['error'] || [];
		let diagnostics: Diagnostic[] = [];

		for (let error of errors) {
			// Information message can either be in form of a simple what tag or a
			// composite xwhat tag
			let message;

			// Error code
			let kind: string;

			// Diagnostic stack trace output
			let stacktrace: StackTrace = [];

			// Misc temp variables
			let auxmessage: string | undefined = undefined;
			let leakedBytes: number | undefined = undefined;

			for (let element of error['$$']) {
				switch (element['#name']) {
					case 'xwhat':
						message = element['text'][0];

						if ('leakedbytes' in element)
							leakedBytes = Number.parseInt(element['leakedbytes'][0]);
						break;
					case 'what':
						message = element['_'];
						break;
					case 'kind':
						kind = element['_'];
						break;
					case 'stack':
						// Frames of the stack
						let frames = element['frame'];

						for (let frame of frames) {
							// Count how many symbols are referenced
							symbols++;

							let ip: string = frame['ip'][0];
							// The following attributes might not be present
							let fn = frame['fn'];
							let dir = frame['dir'];
							let file = frame['file'];
							let line = frame['line'];
							let obj = frame['obj'];

							if (!fn || !dir || !file || !line) {
								// Count the symbols which miss debug information
								unknownSymbols++;
							}

							fn = fn ? fn[0] as string : undefined;
							dir = dir ? dir[0] as string : undefined;
							file = file ? file[0] as string : undefined;
							line = line ? line[0] as string : undefined;
							obj = obj ? obj[0] as string : undefined;

							// Full path of the file
							let fpath = path.join(dir, file)

							stacktrace.push({
								ip: parseInt(ip, 16),
								file: vscode.Uri.file(fpath),
								function: fn,
								line: line,
								obj: obj,
								msg: `at ${fn} (${ip.toLowerCase()})`,
								auxmsg: auxmessage
							})

							auxmessage = undefined;
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

			if (leakedBytes)
				diagnostics.push({
					kind: DiagnosticKind.LEAK,
					msg: message,
					stackTrace: stacktrace,
					type: kind!,
					leakedBytes: leakedBytes
				});
			else
				diagnostics.push({
					kind: DiagnosticKind.GENERIC,
					msg: message,
					stackTrace: stacktrace,
					type: kind!,
				});
		}

		// TODO: Add diagnostic to report too many missing symbols
		console.log(`Unknown symbols ratio: ${unknownSymbols / symbols}`)

		return diagnostics
	}

	getTypeDocumentation(code: string) {
		let uri;

		switch (code) {
			case 'InvalidRead':
			case 'InvalidWrite':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.badrw';
				break;
			case 'UninitValue':
			case 'UninitCondition':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.uninitvals';
				break;
			case 'SyscallParam':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.bad-syscall-args';
				break;
			case 'InvalidFree':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.badfrees';
				break;
			case 'MismatchedFree':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.rudefn';
				break;
			case 'Overlap':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.overlap';
				break;
			case 'FishyValue':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.fishyvalue';
				break;
			case 'Leak_DefinitelyLost':
			case 'Leak_IndirectlyLost':
			case 'Leak_PossiblyLost':
			case 'Leak_StillReachable':
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.leaks';
				break;
			default:
				uri = 'https://www.valgrind.org/docs/manual/mc-manual.html#mc-manual.errormsgs';
				break;
		}

		return vscode.Uri.parse(uri)
	}
}