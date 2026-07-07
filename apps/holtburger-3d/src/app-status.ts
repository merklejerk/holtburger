export interface AppStatus {
	/** Short user-facing description of the current shell state. */
	readonly summary: string;
}

export function createAppStatus(): AppStatus {
	return {
		summary: "A clean app surface is ready for the next renderer architecture.",
	};
}
