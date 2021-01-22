import * as vscode from 'vscode';

import { Diagnostic, DiagnosticKind, LeakDiagnostic, Parser, StackTrace } from '../types';

export class LeakSanitizerParser implements Parser {
	async parse(log: string | vscode.Uri): Promise<Diagnostic[]> {
		// Read logfile if necessary
		const raw = log instanceof vscode.Uri ? await vscode.workspace.fs.readFile(log) : log;
		const report = raw.toString();
		const leaklists = report.match(/(?<===\d+==ERROR: LeakSanitizer: detected memory leaks).*(?=SUMMARY)/s);
		const leaks = leaklists ? leaklists[0].trim().split("\n\n") : [];

		let diagnostics: Diagnostic[] = [];

		for (let leak of leaks) {
			const lines = leak.split("\n");
			const data = lines[0].match(/(?<message>(?<type>[\w\s]+) of (?<leakedBytes>\d+) byte\(s\) in \d+ object\(s\) allocated) from:/)

			if (!data?.groups)
				continue;

			let stackTrace: StackTrace = [];

			for (let i = 1; i < lines.length; i++) {
				// Line number version
				let stackData = lines[i].match(/\s+#(?<n>\d+)\s+(?<ip>[\dxabcdef]+)\s+in\s+(?<function>[\w]+)\s+(?<file>[\w/.:]+):(?<line>\d+)/);

				if (!stackData)
					// Offset version
					stackData = lines[i].match(/\s+#(?<n>\d+)\s+(?<ip>[\dxabcdef]+)\s+in\s+(?<function>[\w]+)\s+\((?<file>[\w/.:]+)\+(?<offset>[\dxabcdef]+)\)/);

				if (!stackData?.groups)
					continue;

				stackTrace.push({
					ip: parseInt(stackData.groups['ip']),
					function: stackData.groups['function'],
					file: vscode.Uri.parse(stackData.groups['file']),
					line: parseInt(stackData.groups['line']),
					msg: `in ${stackData.groups['function']} (${stackData.groups['ip'].toLowerCase()})`
				})
			}

			diagnostics.push({
				kind: DiagnosticKind.LEAK,
				type: data.groups['type'],
				leakedBytes: parseInt(data.groups['leakedBytes']),
				msg: data.groups['message'],
				stackTrace: stackTrace,
			});
		}

		return diagnostics;
	}

	getTypeDocumentation(type: string): vscode.Uri {
		return vscode.Uri.parse("https://github.com/google/sanitizers/wiki/AddressSanitizerLeakSanitizer")
	}
}