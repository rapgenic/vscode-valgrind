import * as vscode from 'vscode';
import * as tmp from 'tmp-promise';
import { Tools } from './tools';

interface ValgrindTaskDefinition extends vscode.TaskDefinition {
	tool?: string,
	command: string,
	leakresolution?: string,
	showleakkinds?: string[],
	undefvalueerrors?: boolean,
	trackorigins?: boolean,
	defaultsuppressions?: boolean,
};

const VALGRIND_TYPE = 'valgrind';
const tools = new Tools();

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

			await tools.parse('valgrind', logfile);
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
			await tools.parse('valgrind', logfile[0]);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('leaksanitizer.load', async () => {
		let logfile = await vscode.window.showOpenDialog({
			title: "Load a LeakSanitizer log file"
		});

		if (logfile)
			await tools.parse('leaksanitizer', logfile[0]);
	}));
}

export function deactivate() {
}
