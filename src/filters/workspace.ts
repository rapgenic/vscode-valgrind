import * as vscode from 'vscode';

import { Diagnostic, Filter, Frame } from '../types';

/**
 * Exclude all the mentioned files not in the workspace
 */
export class WorkspaceFilter implements Filter {
	savedauxmsg: string | undefined = undefined;

	reset() {
		this.savedauxmsg = undefined;
	}

	fileInWorkspace(pathOrUri: vscode.Uri) {
		return vscode.workspace.asRelativePath(pathOrUri, false) != pathOrUri.fsPath;
	}

	filterDiagnostics(element: Diagnostic): boolean {
		// If there is no stack trace that means that no file belonged to the
		// workspace
		return element.stackTrace.length != 0;
	}

	filterStackTrace(element: Frame): boolean {
		if (this.savedauxmsg) {
			element.auxmsg = this.savedauxmsg;
			this.savedauxmsg = undefined;
		}

		if (element.file) {
			if (this.fileInWorkspace(element.file))
				return true;
			else
				// Move the auxmessage to the next frame
				this.savedauxmsg = element.auxmsg;
		}

		return false;
	}
};