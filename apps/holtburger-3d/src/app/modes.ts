export type AppModeId = "client";

export interface AppModeSummary {
	id: AppModeId;
	label: string;
}

export const availableModes: AppModeSummary[] = [
	{
		id: "client",
		label: "World Viewer",
	},
];
