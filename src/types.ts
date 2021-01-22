import * as vscode from 'vscode';

export interface Position {
	/**
	 * File path
	 */
	file: vscode.Uri;

	/**
	 * Line number
	 */
	line: number
};

export interface Frame {
	/**
	 * Instruction offset
	 */
	ip: number

	/**
	 * File path
	 */
	file?: vscode.Uri

	/**
	 * The function name
	 */
	function?: string

	/**
	 * Line number
	 */
	line?: number

	/**
	 * Object file
	 */
	obj?: vscode.Uri

	/**
	 * Message
	 */
	msg?: string

	/**
	 * Additional information
	 */
	auxmsg?: string
}

export type StackTrace = Frame[];

export enum DiagnosticKind {
	LEAK = 'leak',
	GENERIC = 'generic'
};

export interface BaseDiagnostic {
	readonly kind: DiagnosticKind

	/**
	 * Stack trace
	 */
	stackTrace: StackTrace

	/**
	 * Diagnostic message
	 */
	msg: string

	/**
	 * Type (custom for every tool, using strings for simplicity)
	 */
	type: string
}

export interface BaseLeakDiagnostic extends BaseDiagnostic {
	readonly kind: DiagnosticKind

	/**
	 * Leaked bytes
	 */
	leakedBytes: number
}

export interface BaseGenericDiagnostic extends BaseDiagnostic {
	readonly kind: DiagnosticKind
}

export interface LeakDiagnostic extends BaseLeakDiagnostic {
	readonly kind: DiagnosticKind.LEAK
}

export interface GenericDiagnostic extends BaseGenericDiagnostic {
	readonly kind: DiagnosticKind.GENERIC
}

export type Diagnostic = LeakDiagnostic | GenericDiagnostic;

export interface Parser {
	parse(log: string | vscode.Uri): Promise<Diagnostic[]>

	getTypeDocumentation(type: string): vscode.Uri
}

export interface Filter {
	reset(): void

	filterDiagnostics(element: Diagnostic): boolean
	filterStackTrace(element: Frame): boolean
}

export interface Matcher {
	match(diagnostic: Diagnostic): Position | undefined
}

export interface PostProcessor {
	process(diagnostics: Map<Position, Diagnostic[]>): Map<Position, Diagnostic[]>
}

export interface Tool {
	parser: Parser,
	filters: Filter[],
	matcher: Matcher,
	postProcessors: PostProcessor[]
}