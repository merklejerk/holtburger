import { z } from "zod";
import {
	clientUserSettingsSchema,
	type ClientUserSettings,
} from "./client-settings-contract";
import {
	clientCharacterSectionsSchema,
	clientHudPlacementsSchema,
	clientUserSectionsSchema,
	clientUserSettingsPatchSchema,
	type ClientCharacterSettingsPatch,
	type ClientUserSettingsPatch,
	type ClientCharacterSectionValues,
	type ClientUserSectionValues,
} from "./client-settings-sections";
import type { ClientHudLayout } from "./client-hud-layout";

/** Validated, independently loaded user sections. */
interface ClientUserSettingsLoad {
	readonly sections: Partial<ClientUserSectionValues>;
	readonly hudPlacements: Partial<ClientHudLayout>;
	readonly unavailable: readonly string[];
}

/** Validated, independently loaded character sections. */
export interface ClientCharacterSettingsLoad {
	readonly sections: Partial<ClientCharacterSectionValues>;
	readonly unavailable: readonly string[];
}

const userLoadSchema = z
	.object({
		sections: clientUserSectionsSchema,
		hudPlacements: clientHudPlacementsSchema,
		unavailable: z.array(z.string()),
	})
	.strict();

const characterLoadSchema = z
	.object({
		sections: clientCharacterSectionsSchema,
		unavailable: z.array(z.string()),
	})
	.strict();

interface ElectronSettingsBridge {
	loadUser(): Promise<unknown>;
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void>;
	resetUser(settings: ClientUserSettings): Promise<unknown>;
	loadCharacter(characterGuid: number): Promise<unknown>;
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
	loadUser(): Promise<ClientUserSettingsLoad>;
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void>;
	resetUser(settings: ClientUserSettings): Promise<readonly string[]>;
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
		async loadUser() {
			return parseUserSettingsLoad(await bridge.loadUser());
		},
		saveUserPatch(patch) {
			return bridge.saveUserPatch(clientUserSettingsPatchSchema.parse(patch));
		},
		async resetUser(settings) {
			return z
				.array(z.string())
				.parse(
					await bridge.resetUser(clientUserSettingsSchema.parse(settings)),
				);
		},
		async loadCharacter(characterGuid) {
			return parseCharacterSettingsLoad(
				await bridge.loadCharacter(characterGuid),
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
