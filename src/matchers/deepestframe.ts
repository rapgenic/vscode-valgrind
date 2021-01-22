import { Diagnostic, Matcher, Position } from '../types';

export class DeepestFrameMatcher implements Matcher {
	match(diagnostic: Diagnostic): Position | undefined {
		for (let i = 0; i < diagnostic.stackTrace.length; i++) {
			let frame = diagnostic.stackTrace[i];

			if (frame.file && frame.line) {
				if (frame.msg) diagnostic.msg += ` ${frame.msg}`

				return {
					file: frame.file,
					line: frame.line
				};
			}
		}
	}
}