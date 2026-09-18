import { z } from "zod";
import {
	clientCharacterSettingsSchema,
	clientUserSettingsSchema,
	parseClientCharacterSettings,
	parseClientUserSettings,
	type ClientCharacterSettings,
	type ClientUserSettings,
} from "./client-settings-contract";

type ClientUserSettingsLoad =
	| { readonly kind: "missing" }
	| { readonly kind: "loaded"; readonly settings: ClientUserSettings };

export type ClientCharacterSettingsLoad =
	| { readonly kind: "missing" }
	| {
			readonly kind: "loaded";
			readonly settings: ClientCharacterSettings;
			readonly lastKnownName: string | null;
	  };

const clientUserSettingsLoadSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("missing") })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("loaded"), settings: clientUserSettingsSchema })
		.strict()
		.readonly(),
]);

const clientCharacterSettingsLoadSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("missing") })
		.strict()
		.readonly(),
	z
		.object({
			kind: z.literal("loaded"),
			settings: clientCharacterSettingsSchema,
			lastKnownName: z.string().min(1).max(128).nullable(),
		})
		.strict()
		.readonly(),
]);

interface ElectronSettingsBridge {
	loadUser(): Promise<unknown>;
	saveUser(settings: ClientUserSettings): Promise<void>;
	loadCharacter(characterGuid: number): Promise<unknown>;
	saveCharacter(
		characterGuid: number,
		settings: ClientCharacterSettings,
		lastKnownName: string | null,
	): Promise<void>;
}

declare global {
	interface Window {
		holtburgerSettings?: ElectronSettingsBridge;
	}
}

/** Renderer-facing local settings capability, separate from sidecar host transport. */
export interface ClientSettingsTransport {
	loadUser(): Promise<ClientUserSettingsLoad>;
	saveUser(settings: ClientUserSettings): Promise<void>;
	loadCharacter(characterGuid: number): Promise<ClientCharacterSettingsLoad>;
	saveCharacter(
		characterGuid: number,
		settings: ClientCharacterSettings,
		lastKnownName: string | null,
	): Promise<void>;
}

/** Validate every preload result before publishing it into renderer ownership. */
export function createElectronClientSettingsTransport(): ClientSettingsTransport {
	const bridge = globalThis.window?.holtburgerSettings;
	if (bridge === undefined)
		throw new Error("Electron settings bridge is unavailable");
	return {
		async loadUser() {
			return parseUserSettingsLoad(await bridge.loadUser());
		},
		saveUser(settings) {
			return bridge.saveUser(parseClientUserSettings(settings));
		},
		async loadCharacter(characterGuid) {
			return parseCharacterSettingsLoad(
				await bridge.loadCharacter(characterGuid),
			);
		},
		saveCharacter(characterGuid, settings, lastKnownName) {
			return bridge.saveCharacter(
				characterGuid,
				parseClientCharacterSettings(settings),
				lastKnownName,
			);
		},
	};
}

function parseUserSettingsLoad(value: unknown): ClientUserSettingsLoad {
	try {
		return clientUserSettingsLoadSchema.parse(value);
	} catch (cause) {
		throw new Error("Malformed user settings response", { cause });
	}
}

function parseCharacterSettingsLoad(
	value: unknown,
): ClientCharacterSettingsLoad {
	try {
		return clientCharacterSettingsLoadSchema.parse(value);
	} catch (cause) {
		throw new Error("Malformed character settings response", { cause });
	}
}
