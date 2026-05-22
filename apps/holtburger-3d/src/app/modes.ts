export type AppModeId = "browser";

export interface AppModeSummary {
	id: AppModeId;
	label: string;
}

export const availableModes: AppModeSummary[] = [
	{
		id: "browser",
		label: "Scene Browser",
	},
];
