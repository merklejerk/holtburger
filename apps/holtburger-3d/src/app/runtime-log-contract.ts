/** A run of identical warning or error messages from the client document. */
export interface RuntimeLogEntry {
	readonly time: string;
	readonly level: "warning" | "error";
	readonly message: string;
	readonly count: number;
}

/** A bounded snapshot ordered from oldest to newest. */
export interface RuntimeLogSnapshot {
	readonly revision: number;
	readonly entries: readonly RuntimeLogEntry[];
}
