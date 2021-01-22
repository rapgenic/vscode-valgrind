import * as vscode from 'vscode';

import { Tool } from './types';
import { ValgrindParser } from './parsers/valgrind';
import { WorkspaceFilter } from './filters/workspace';
import { DeepestFrameMatcher } from './matchers/deepestframe';
import { LeakCompacterProcessor } from './postprocessors/leakcompacter';
import { Runner } from './runner';
import { LeakSanitizerParser } from './parsers/leaksanitizer';

export class Tools {
	private tools: Map<string, Tool>
	private runners: Map<string, Runner>

	constructor() {
		this.tools = new Map<string, Tool>();
		this.runners = new Map<string, Runner>();

		this.tools.set('valgrind', {
			parser: new ValgrindParser(),
			filters: [new WorkspaceFilter()],
			matcher: new DeepestFrameMatcher(),
			postProcessors: [new LeakCompacterProcessor("${leakedBytes} are ${type} at ${function} ${ip}")]
		});
		this.tools.set('leaksanitizer', {
			parser: new LeakSanitizerParser(),
			filters: [new WorkspaceFilter()],
			matcher: new DeepestFrameMatcher(),
			postProcessors: [new LeakCompacterProcessor("${type} of ${leakedBytes} byte(s) allocated in ${function} (${ip})")]
		});
	}

	async parse(toolName: string, log: string | vscode.Uri) {
		if (!this.runners.has(toolName)) {
			let tool = this.tools.get(toolName);

			if (tool) {
				let diagnosticsCollection = vscode.languages.createDiagnosticCollection(toolName);

				this.runners.set(toolName, new Runner(tool, diagnosticsCollection));
			}
		}

		await this.runners.get(toolName)!.parse(log);
	}
}