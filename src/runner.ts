import * as vscode from 'vscode';

import { Diagnostic, Position, Tool } from './types';

export class Runner {
	constructor(
		private tool: Tool,
		private diagnosticsCollection: vscode.DiagnosticCollection
	) { }

	getLineRange(line: number) {
		return new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER);
	}

	async parse(log: string | vscode.Uri) {
		// Parse
		let diagnostics = await this.tool.parser.parse(log);

		// Run filters
		for (let filter of this.tool.filters) {
			for (let diagnostic of diagnostics) {
				filter.reset();
				diagnostic.stackTrace = diagnostic.stackTrace.filter(filter.filterStackTrace, filter);
			}

			filter.reset();
			diagnostics = diagnostics.filter(filter.filterDiagnostics, filter);
		}

		// Match to files
		let matchedDiagnostics = new Map<Position, Diagnostic[]>();

		for (let diagnostic of diagnostics) {
			let position = this.tool.matcher.match(diagnostic);

			if (position) {
				let present = false;

				for (let [pos, diagnostics] of matchedDiagnostics) {
					if (position.file.fsPath == pos.file.fsPath &&
						position.line == pos.line) {
						diagnostics.push(diagnostic);
						present = true;
						break;
					}
				}

				if (!present)
					matchedDiagnostics.set(position, [diagnostic]);
			}
		}

		// Run postprocessors
		for (let postProcessor of this.tool.postProcessors) {
			matchedDiagnostics = postProcessor.process(matchedDiagnostics);
		}

		// Fill in vscode diagnostics
		this.diagnosticsCollection.clear();

		for (let [position, diagnostics] of matchedDiagnostics) {
			for (let diagnostic of diagnostics) {
				let previous;

				if (this.diagnosticsCollection.has(position.file)) {
					previous = this.diagnosticsCollection.get(position.file)!;
				}

				let vsdiagnostic = new vscode.Diagnostic(
					new vscode.Range(
						position.line - 1, 0,
						position.line - 1, Number.MAX_SAFE_INTEGER
					),
					diagnostic.msg
				)

				vsdiagnostic.code = {
					value: diagnostic.type,
					target: this.tool.parser.getTypeDocumentation(diagnostic.type)
				};
				vsdiagnostic.source = this.diagnosticsCollection.name;
				vsdiagnostic.relatedInformation = [];

				for (let i = 1; i < diagnostic.stackTrace.length; i++) {
					let frame = diagnostic.stackTrace[i];
					if (frame.file && frame.line) {
						let message = "";

						if (frame.auxmsg) message += frame.auxmsg + ' ';
						if (frame.msg) message += frame.msg;

						vsdiagnostic.relatedInformation?.push(new vscode.DiagnosticRelatedInformation(
							new vscode.Location(
								frame.file,
								this.getLineRange(frame.line)
							),
							message
						));
					}
				}

				this.diagnosticsCollection.set(position.file, [
					...previous || [],
					vsdiagnostic
				])
			}

		}
	}
}