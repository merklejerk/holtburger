export type AppModeId = "browser" | "client";

export interface AppModeSummary {
	id: AppModeId;
	label: string;
	summary: string;
}

export const availableModes: AppModeSummary[] = [
	{
		id: "browser",
		label: "Browser Mode",
		summary:
			"Starts from a coordinate or location input and prioritizes world display and asset seams.",
	},
	{
		id: "client",
		label: "Client Mode",
		summary:
			"Later home for login, character selection, lifecycle wiring, and in-world gameplay semantics.",
	},
];
