import { availableModes, type AppModeId } from "./modes";

export interface AppShellState {
	title: string;
	activeMode: AppModeId;
}

export const appShellState: AppShellState = {
	title: "World viewer shell is wired for boundary-driven growth.",
	activeMode: "client",
};

export { availableModes };
