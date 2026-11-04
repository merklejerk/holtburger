import { describe, expect, it, vi } from "vitest";
import { HostCommandError } from "../host/host-command-result";

import type {
	DecodedAnimationAsset,
	DecodedAnimationHook,
} from "../assets/decode-animation-record";
import type { DecodedSoundTable } from "../assets/decode-sound-table-record";
import type { DecodedStaticPresentation } from "../assets/decode-static-source-record";
import type { AnimationAssetSource } from "../assets/animation-asset-source";
import type { SetupVisualSource } from "../assets/setup-visual-source";
import type { SoundTableSource } from "../assets/sound-table-source";
import type { AudioDevice } from "../game/systems/audio-system";
import type { DatAssetId } from "../game/game-types";
import { Mat4 } from "../game/math/types";
import { resolveObjectBehavior } from "../game/resolution/object-resident-classifier";
import {
	loadPortalTransitionAssets,
	preparePortalTransitionAudio,
	withPortalTransitionAudio,
	type PortalTransitionAssetSources,
} from "./portal-transition-assets";

const SETUP = "0x02000306" as DatAssetId;
const ANIMATION = "0x030005ac" as DatAssetId;
const SOUND_TABLE = "0x2000004b" as DatAssetId;
const ENTER_SOUND = "0x0a000246" as DatAssetId;
const EXIT_SOUND = "0x0a000245" as DatAssetId;
const HOOK_SOUND = "0x0a000316" as DatAssetId;

describe("loadPortalTransitionAssets", () => {
	it("uses an explicit absent visual result for source failures while preserving schema faults", async () => {
		const sources = portalSources();
		sources.animation.loadAnimation = async () => {
			throw sourceFailure(ANIMATION);
		};
		await expect(loadPortalTransitionAssets(sources)).resolves.toBeNull();
		expect(sources.reportContentFailure).toHaveBeenCalledOnce();
		sources.animation.loadAnimation = async () => {
			throw new Error("Unexpected animation magic");
		};
		await expect(loadPortalTransitionAssets(sources)).rejects.toThrow(
			"Unexpected animation magic",
		);
	});

	it("retains portal artwork and retries only missing audio buffers", async () => {
		const sources = portalSources();
		const ready = new Set<DatAssetId>();
		let broken = true;
		const loads: DatAssetId[] = [];
		sources.audio.prepare = async (id) => {
			if (ready.has(id)) return;
			loads.push(id);
			if (id === ENTER_SOUND && broken) throw sourceFailure(id);
			ready.add(id);
		};
		const assets = await loadPortalTransitionAssets(sources);
		if (assets === null)
			throw new Error("Valid portal art must survive an absent sound");
		expect(assets.waveIds).toEqual([EXIT_SOUND, HOOK_SOUND]);
		broken = false;
		const retried = withPortalTransitionAudio(
			assets,
			await preparePortalTransitionAudio(
				sources.audio,
				sources.soundTable,
				sources.reportContentFailure,
			),
		);
		expect(retried.waveIds).toEqual([ENTER_SOUND, EXIT_SOUND, HOOK_SOUND]);
		expect(retried.visual).toBe(assets.visual);
		expect(retried.animation).toBe(assets.animation);
		expect(loads.filter((id) => id === EXIT_SOUND)).toHaveLength(1);
		expect(loads.filter((id) => id === ENTER_SOUND)).toHaveLength(2);
	});

	it("keeps portal art usable without its optional sound table and recovers the table on audio retry", async () => {
		const sources = portalSources();
		const loadTable = sources.soundTable.loadSoundTable;
		sources.soundTable.loadSoundTable = async () => {
			throw sourceFailure(SOUND_TABLE);
		};
		const assets = await loadPortalTransitionAssets(sources);
		expect(assets?.soundTable).toBeNull();
		expect(assets?.waveIds).toHaveLength(3);
		if (assets === null)
			throw new Error("Valid portal artwork must survive table refusal");
		sources.soundTable.loadSoundTable = loadTable;
		const retried = withPortalTransitionAudio(
			assets,
			await preparePortalTransitionAudio(
				sources.audio,
				sources.soundTable,
				sources.reportContentFailure,
			),
		);
		expect(retried.soundTable?.id).toBe(SOUND_TABLE);
		expect(retried.visual).toBe(assets.visual);
		expect(retried.animation).toBe(assets.animation);
	});
	it("loads the fixed authored assets once and reports complete source bytes", async () => {
		const calls = { animation: 0, setup: 0, soundTable: 0 };
		const waveBytes = new Map<DatAssetId, number>([
			[ENTER_SOUND, 11],
			[EXIT_SOUND, 13],
			[HOOK_SOUND, 17],
		]);
		const audio: AudioDevice = {
			getPreparedSourceBytes: (soundId) => waveBytes.get(soundId) ?? null,
			playOneShot: () => null,
			prepare: async () => {},
		};
		const assets = await loadPortalTransitionAssets({
			reportContentFailure: () => {
				throw new Error("Valid portal must not degrade");
			},
			animation: {
				destroy: () => {},
				loadAnimation: async () => {
					calls.animation += 1;
					return animation();
				},
				loadMotionTableClosure: async () => [],
			} satisfies AnimationAssetSource,
			audio,
			setupVisual: {
				load: async () => {
					calls.setup += 1;
					return visual();
				},
			} satisfies SetupVisualSource,
			soundTable: {
				destroy: () => {},
				loadSoundTable: async () => {
					calls.soundTable += 1;
					return soundTable();
				},
			} satisfies SoundTableSource,
		});
		if (assets === null) throw new Error("Valid portal fixture must load");

		expect(calls).toEqual({ animation: 1, setup: 1, soundTable: 1 });
		expect(assets.catalog.animationLowFrame).toBe(1);
		expect(assets.waveIds).toEqual([ENTER_SOUND, EXIT_SOUND, HOOK_SOUND]);
		expect(assets.sourceBytes).toEqual({
			animation: 200,
			setupVisual: 100,
			soundTable: 300,
			total: 641,
			waves: 41,
		});
	});

	it("fails before preparing waves when a required table entry is absent", async () => {
		let prepared = 0;
		await expect(
			loadPortalTransitionAssets({
				reportContentFailure: () => {
					throw new Error("Valid portal must not degrade");
				},
				animation: {
					destroy: () => {},
					loadAnimation: async () => animation(),
					loadMotionTableClosure: async () => [],
				},
				audio: {
					playOneShot: () => null,
					prepare: async () => {
						prepared += 1;
					},
				},
				setupVisual: { load: async () => visual() },
				soundTable: {
					destroy: () => {},
					loadSoundTable: async () => ({
						entries: new Map(),
						id: SOUND_TABLE,
					}),
				},
			}),
		).rejects.toThrow(/missing sound/);
		expect(prepared).toBe(0);
	});
});

/** Real source classifications with no dependency on an installed archive. */
function sourceFailure(id: DatAssetId): HostCommandError {
	return new HostCommandError({
		code: "application_error",
		message: `Missing ${id}`,
		resource: { kind: "missing", namespace: "eor/portal", file_id: Number(id) },
	});
}

function portalSources(): PortalTransitionAssetSources {
	return {
		reportContentFailure: vi.fn(),
		animation: {
			destroy() {},
			loadAnimation: async () => animation(),
			loadMotionTableClosure: async () => [],
		},
		setupVisual: { load: async () => visual() },
		soundTable: { destroy() {}, loadSoundTable: async () => soundTable() },
		audio: { playOneShot: () => null, prepare: async () => {} },
	};
}

function visual(): DecodedStaticPresentation {
	return {
		behavior: resolveObjectBehavior({
			animationId: null,
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		}),
		localBounds: null,
		presentation: {
			appearanceKey: "portal-transition",
			holdingLocations: new Map(),
			id: "presentation:portal-transition",
			lights: [],
			parts: [],
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: SETUP,
		},
		partParents: [],
		setupId: SETUP,
		sourceByteLength: 100,
	};
}

function animation(): DecodedAnimationAsset {
	const hook: DecodedAnimationHook = {
		authoredOrder: 0,
		direction: "both",
		frameIndex: 2,
		kind: "sound-tweaked",
		probability: 1,
		soundId: HOOK_SOUND,
		volume: 0.3,
	};
	return {
		frameCount: 120,
		hooks: [hook],
		id: ANIMATION,
		partCount: 2,
		partFrames: Array.from({ length: 240 }, () => Mat4.identity()),
		positionFrames: [],
		sourceByteLength: 200,
	};
}

function soundTable(): DecodedSoundTable {
	return {
		entries: new Map([
			[0x6a, [{ probability: 1, soundId: ENTER_SOUND, volume: 1 }]],
			[0x6b, [{ probability: 1, soundId: EXIT_SOUND, volume: 1 }]],
		]),
		id: SOUND_TABLE,
		sourceByteLength: 300,
	};
}
