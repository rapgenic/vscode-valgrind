import { Diagnostic, PostProcessor, LeakDiagnostic, Position } from '../types';

export class LeakCompacterProcessor implements PostProcessor {
	constructor(private template: string) { }

	process(diagnosticsMap: Map<Position, Diagnostic[]>): Map<Position, Diagnostic[]> {
		for (let [pos, diagnostics] of diagnosticsMap) {
			let compactDiagnostics: Diagnostic[] = [];

			for (let diagnostic of diagnostics) {
				if (diagnostic.kind == 'leak') {
					// Get the same leak kinds for the same position
					let previousleakmessages = compactDiagnostics.filter(
						d => d.type == diagnostic.type
					);

					if (previousleakmessages.length) {
						let p = previousleakmessages[0] as LeakDiagnostic;

						p.leakedBytes += diagnostic.leakedBytes;
						p.msg = this.template
							.replace('${leakedBytes}', p.leakedBytes.toString())
							.replace('${type}', diagnostic.type)
							.replace('${function}', diagnostic.stackTrace[0].function?.toString() || "unknown")
							.replace('${ip}', diagnostic.stackTrace[0].ip.toString(16))
						p.stackTrace = []

						continue;
					}
				}

				compactDiagnostics.push(diagnostic);
			}

			diagnosticsMap.set(pos, compactDiagnostics);
		}

		return diagnosticsMap;
	}
};