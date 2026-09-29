import { createDefaultClientCharacterSettings } from "./client-settings-defaults";
import { ClientSettingsPersistence } from "./client-settings-persistence";
import type {
	ClientCharacterSettingsLoad,
	ClientSettingsTransport,
} from "./client-settings-transport";
import type { ClientCharacterSettings } from "./client-settings-contract";
import type { ClientCharacterSettingsPatch } from "./client-settings-sections";

export type ClientCharacterSettingsState =
	| { readonly kind: "absent" }
	| {
			readonly kind: "loading";
			readonly characterGuid: number;
			readonly generation: number;
	  }
	| {
			readonly kind: "ready";
			readonly characterGuid: number;
			readonly generation: number;
			readonly settings: ClientCharacterSettings;
			readonly lastKnownName: string | null;
	  };

interface CharacterSettingsSave {
	readonly characterGuid: number;
	readonly patch: ClientCharacterSettingsPatch;
}

/** Owns generation-gated character profile hydration and save publication. */
export class ClientCharacterSettingsOwner {
	readonly #transport: Pick<
		ClientSettingsTransport,
		"loadCharacter" | "saveCharacterPatch"
	>;
	readonly #publish: (state: ClientCharacterSettingsState) => void;
	readonly #loadFailed: (error: unknown) => void;
	readonly #unavailable: (reasons: readonly string[]) => void;
	readonly #persistence: ClientSettingsPersistence<CharacterSettingsSave>;
	#state: ClientCharacterSettingsState = { kind: "absent" };
	#generation = 0;
	#observedName: {
		readonly characterGuid: number;
		readonly name: string;
	} | null = null;

	constructor(options: {
		readonly transport: Pick<
			ClientSettingsTransport,
			"loadCharacter" | "saveCharacterPatch"
		>;
		readonly publish: (state: ClientCharacterSettingsState) => void;
		readonly loadFailed: (error: unknown) => void;
		readonly unavailable: (reasons: readonly string[]) => void;
		readonly saveFailed: (error: unknown) => void;
		readonly saveDelayMs: number;
	}) {
		this.#transport = options.transport;
		this.#publish = options.publish;
		this.#loadFailed = options.loadFailed;
		this.#unavailable = options.unavailable;
		this.#persistence = new ClientSettingsPersistence({
			delayMs: options.saveDelayMs,
			save: (snapshot: CharacterSettingsSave) =>
				this.#transport.saveCharacterPatch(
					snapshot.characterGuid,
					snapshot.patch,
				),
			report: options.saveFailed,
			merge: (pending, next) => {
				if (pending.characterGuid !== next.characterGuid)
					throw new Error("Cannot merge settings for different characters");
				return {
					characterGuid: next.characterGuid,
					patch: { ...pending.patch, ...next.patch },
				};
			},
		});
	}

	state(): ClientCharacterSettingsState {
		return this.#state;
	}

	acceptGuid(characterGuid: number | null): void {
		if (characterGuid === null) {
			this.retire();
			return;
		}
		if (
			this.#state.kind !== "absent" &&
			this.#state.characterGuid === characterGuid
		)
			return;
		const generation = ++this.#generation;
		this.#set({ kind: "loading", characterGuid, generation });
		void this.#hydrate(characterGuid, generation);
	}

	acceptName(characterGuid: number, name: string): void {
		this.#observedName = { characterGuid, name };
		if (
			this.#state.kind !== "ready" ||
			this.#state.characterGuid !== characterGuid ||
			this.#state.lastKnownName === name
		)
			return;
		this.#set({ ...this.#state, lastKnownName: name });
		this.#queueReady({ lastKnownName: name });
	}

	change<Key extends keyof ClientCharacterSettings>(
		key: Key,
		value: ClientCharacterSettings[Key],
	): void {
		if (this.#state.kind !== "ready") return;
		this.#set({
			...this.#state,
			settings: { ...this.#state.settings, [key]: value },
		});
		this.#queueReady({ [key]: value });
	}

	retire(): void {
		if (this.#state.kind === "absent") return;
		this.#generation += 1;
		this.#set({ kind: "absent" });
		void this.#persistence.flush().catch(() => undefined);
	}

	flush(): Promise<void> {
		return this.#persistence.flush();
	}

	async #hydrate(characterGuid: number, generation: number): Promise<void> {
		// The failed old-character patch cannot be merged with the next profile.
		try {
			await this.#persistence.flush();
		} catch {
			this.#persistence.discardPending();
		}
		let loaded: ClientCharacterSettingsLoad;
		try {
			loaded = await this.#transport.loadCharacter(characterGuid);
		} catch (error) {
			if (this.#isCurrentLoad(characterGuid, generation))
				this.#loadFailed(error);
			return;
		}
		if (!this.#isCurrentLoad(characterGuid, generation)) return;
		if (loaded.unavailable.length > 0) this.#unavailable(loaded.unavailable);
		const defaults = createDefaultClientCharacterSettings();
		const { lastKnownName, ...savedSettings } = loaded.sections;
		this.#set({
			kind: "ready",
			characterGuid,
			generation,
			settings: { ...defaults, ...savedSettings },
			lastKnownName:
				this.#observedName?.characterGuid === characterGuid
					? this.#observedName.name
					: (lastKnownName ?? null),
		});
	}

	#isCurrentLoad(characterGuid: number, generation: number): boolean {
		return (
			this.#state.kind === "loading" &&
			this.#state.characterGuid === characterGuid &&
			this.#state.generation === generation
		);
	}

	#queueReady(patch: ClientCharacterSettingsPatch): void {
		if (this.#state.kind !== "ready") return;
		this.#persistence.publish({
			characterGuid: this.#state.characterGuid,
			patch,
		});
	}

	#set(state: ClientCharacterSettingsState): void {
		this.#state = state;
		this.#publish(state);
	}
}
