import { z } from "zod";
import {
	explorerHudLayoutSchema,
	explorerUserSettingsContextSchema,
	type ExplorerUserSettingsContext,
} from "./explorer-settings-contract";
import {
	explorerResetSettingsSchema,
	explorerRuntimeSectionSchemas,
	explorerUserSettingsPatchSchema,
	type ExplorerResetSettings,
	type ExplorerUserSettings,
	type ExplorerUserSettingsPatch,
} from "./explorer-settings-sections";

interface ExplorerUserSettingsLoad {
	readonly settings: ExplorerUserSettings;
	readonly repaired: readonly string[];
}

const explorerUserSettingsSchema = z
	.object({
		...explorerRuntimeSectionSchemas,
		explorerHudLayout: explorerHudLayoutSchema,
	})
	.strict()
	.readonly();

const explorerLoadSchema = z
	.object({
		settings: explorerUserSettingsSchema,
		repaired: z.array(z.string()),
	})
	.strict();

interface ElectronExplorerSettingsBridge {
	loadExplorerUser?(context: ExplorerUserSettingsContext): Promise<unknown>;
	saveExplorerUserPatch?(patch: ExplorerUserSettingsPatch): Promise<void>;
	resetExplorerUser?(settings: ExplorerResetSettings): Promise<unknown>;
}

/** Renderer-facing local settings capability for Explorer mode. */
export interface ExplorerSettingsTransport {
	loadUser(
		context: ExplorerUserSettingsContext,
	): Promise<ExplorerUserSettingsLoad>;
	saveUserPatch(patch: ExplorerUserSettingsPatch): Promise<void>;
	resetExplorer(settings: ExplorerResetSettings): Promise<void>;
}

export function createElectronExplorerSettingsTransport(): ExplorerSettingsTransport {
	const bridge = globalThis.window?.holtburgerSettings as
		ElectronExplorerSettingsBridge | undefined;
	if (
		bridge?.loadExplorerUser === undefined ||
		bridge.saveExplorerUserPatch === undefined ||
		bridge.resetExplorerUser === undefined
	)
		throw new Error("Electron Explorer settings bridge is unavailable");
	const load = bridge.loadExplorerUser;
	const save = bridge.saveExplorerUserPatch;
	const reset = bridge.resetExplorerUser;
	return {
		async loadUser(context) {
			const raw = await load(explorerUserSettingsContextSchema.parse(context));
			try {
				return explorerLoadSchema.parse(raw);
			} catch (cause) {
				throw new Error("Malformed Explorer user settings response", { cause });
			}
		},
		saveUserPatch(patch) {
			return save(explorerUserSettingsPatchSchema.parse(patch));
		},
		async resetExplorer(settings) {
			await reset(explorerResetSettingsSchema.parse(settings));
		},
	};
}
