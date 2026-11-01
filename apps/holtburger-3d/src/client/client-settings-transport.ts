import { z } from "zod";
import {
	clientUserSettingsSchema,
	clientCharacterSettingsSchema,
	type ClientUserSettings,
	type ClientCharacterSettings,
} from "./client-settings-contract";
import {
	clientCharacterSectionsSchema,
	clientUserSettingsContextSchema,
	type ClientUserSettingsContext,
	clientUserSettingsPatchSchema,
	type ClientCharacterSettingsPatch,
	type ClientUserSettingsPatch,
	type ClientCharacterSectionValues,
} from "./client-settings-sections";
import { createDefaultClientCharacterSettings } from "./client-settings-defaults";

/** Complete, scale-aware bootstrap assembled by the app-local settings adapter. */
interface ClientUserSettingsLoad {
	readonly settings: ClientUserSettings;
	/** Persisted repairs, reported only after successful replacement. */
	readonly repaired: readonly string[];
}

/** Validated, independently loaded character sections. */
export interface ClientCharacterSettingsLoad {
	readonly sections: Partial<ClientCharacterSectionValues>;
	/** Persisted repairs for this character, reported once after replacement. */
	readonly repaired: readonly string[];
}

const userLoadSchema = z
	.object({
		settings: clientUserSettingsSchema,
		repaired: z.array(z.string()),
	})
	.strict();

const characterLoadSchema = z
	.object({
		sections: clientCharacterSectionsSchema,
		repaired: z.array(z.string()),
	})
	.strict();

interface ElectronSettingsBridge {
	loadUser(context: ClientUserSettingsContext): Promise<unknown>;
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void>;
	resetUser(settings: ClientUserSettings): Promise<unknown>;
	loadCharacter(
		characterGuid: number,
		defaults: ClientCharacterSettings,
	): Promise<unknown>;
	saveCharacterPatch(
		characterGuid: number,
		patch: ClientCharacterSettingsPatch,
	): Promise<void>;
}

declare global {
	interface Window {
		holtburgerSettings?: ElectronSettingsBridge;
	}
}

/** Renderer-facing local settings capability, separate from sidecar host transport. */
export interface ClientSettingsTransport {
	loadUser(context: ClientUserSettingsContext): Promise<ClientUserSettingsLoad>;
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void>;
	resetUser(settings: ClientUserSettings): Promise<void>;
	loadCharacter(characterGuid: number): Promise<ClientCharacterSettingsLoad>;
	saveCharacterPatch(
		characterGuid: number,
		patch: ClientCharacterSettingsPatch,
	): Promise<void>;
}

/** Validate every preload result and request at the renderer boundary. */
export function createElectronClientSettingsTransport(): ClientSettingsTransport {
	const bridge = globalThis.window?.holtburgerSettings;
	if (bridge === undefined)
		throw new Error("Electron settings bridge is unavailable");
	return {
		async loadUser(context) {
			return parseUserSettingsLoad(
				await bridge.loadUser(clientUserSettingsContextSchema.parse(context)),
			);
		},
		saveUserPatch(patch) {
			return bridge.saveUserPatch(clientUserSettingsPatchSchema.parse(patch));
		},
		async resetUser(settings) {
			await bridge.resetUser(clientUserSettingsSchema.parse(settings));
		},
		async loadCharacter(characterGuid) {
			return parseCharacterSettingsLoad(
				await bridge.loadCharacter(
					characterGuid,
					clientCharacterSettingsSchema.parse(
						createDefaultClientCharacterSettings(),
					),
				),
			);
		},
		saveCharacterPatch(characterGuid, patch) {
			return bridge.saveCharacterPatch(
				characterGuid,
				clientCharacterSectionsSchema.parse(patch),
			);
		},
	};
}

function parseUserSettingsLoad(value: unknown): ClientUserSettingsLoad {
	try {
		return userLoadSchema.parse(value);
	} catch (cause) {
		throw new Error("Malformed user settings response", { cause });
	}
}

function parseCharacterSettingsLoad(
	value: unknown,
): ClientCharacterSettingsLoad {
	try {
		return characterLoadSchema.parse(value);
	} catch (cause) {
		throw new Error("Malformed character settings response", { cause });
	}
}
