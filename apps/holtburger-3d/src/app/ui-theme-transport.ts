import {
	uiThemeCatalogSchema,
	uiThemeIdSchema,
	uiThemeUrlSchema,
	type UiThemeTransport,
} from "./ui-theme-contract";

/** Untrusted preload results are validated before reaching the selection owner. */
interface ElectronThemeBridge {
	list(): Promise<unknown>;
	resolve(id: string): Promise<unknown>;
	openDirectory(): Promise<void>;
}
declare global {
	interface Window {
		holtburgerThemes?: ElectronThemeBridge;
	}
}

/** Desktop theme capability is independent of gameplay and settings transports. */
export function createElectronUiThemeTransport(): UiThemeTransport {
	const bridge = window.holtburgerThemes;
	if (bridge === undefined)
		throw new Error("Electron theme bridge is unavailable");
	return {
		async list() {
			return uiThemeCatalogSchema.parse(await bridge.list());
		},
		async resolve(id) {
			return uiThemeUrlSchema.parse(
				await bridge.resolve(uiThemeIdSchema.parse(id)),
			);
		},
		openDirectory: () => bridge.openDirectory(),
	};
}
