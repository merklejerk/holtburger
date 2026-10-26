import { z } from "zod";

/** Theme folders are portable single path components; names double as display labels. */
export const uiThemeIdSchema = z
	.string()
	.min(1)
	.refine(
		(id) =>
			id !== "." &&
			id !== ".." &&
			!/[\\/<>:"|?*]/u.test(id) &&
			[...id].every((character) => character.charCodeAt(0) >= 32),
		"Theme ID must be a single portable folder name",
	);

/** Resource namespace shared by native serving and renderer URL validation. */
export const UI_THEME_SCHEME = "holtburger-theme";

/** One operation budget covers resolution and stylesheet loading, below native close admission. */
export const UI_THEME_LOAD_TIMEOUT_MS = 3_000;

/** Catalog entries are folder IDs, without duplicated labels or persisted asset URLs. */
export const uiThemeCatalogSchema = z.array(uiThemeIdSchema).readonly();

/** Only the native theme resource scheme may cross the preload URL boundary. */
export const uiThemeUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		const url = new URL(value);
		return url.protocol === `${UI_THEME_SCHEME}:` && url.host === "local";
	}, "Invalid theme resource URL");

/** Renderer-owned discovery capability; native code owns all filesystem paths. */
export interface UiThemeTransport {
	list(): Promise<readonly string[]>;
	resolve(id: string): Promise<string>;
	openDirectory(): Promise<void>;
}
