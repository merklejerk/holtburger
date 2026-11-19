import { isContentFailure } from "../../host/host-command-result";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	renderVector3,
	sceneVector3,
	type SceneVector3,
} from "../../assets/ac-frame";
import {
	selectSoundCandidate,
	type DecodedSoundTable,
} from "../../assets/decode-sound-table-record";
import type { SoundTableSource } from "../../assets/sound-table-source";
import type {
	BehaviorConsumers,
	BehaviorTarget,
	BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import { SoundTableRepository } from "../behavior/sound-table-repository";
import type { DatAssetId, EnvCellId } from "../game-types";
import { createLandblockWorldOrigin } from "../landblocks";
import type { SceneNodeId } from "../scene";
import { sceneNodeIdOf } from "../scene/utils";
import {
	ambientSoundTableIds,
	createAmbientRegionResolution,
	type AmbientRegionFacts,
	type AmbientRegionResolution,
} from "../systems/ambient-region";
import {
	AmbientBakeRegistry,
	EMPTY_AMBIENT_SCAN_RESULT,
	accumulateAmbientWeights,
	scanAmbientSources,
	type InstalledAmbientTerrain,
} from "../systems/ambient-scan";
import { AmbientSystem } from "../systems/ambient-system";
import {
	AudioSystem,
	type AudioDevice,
	type AudioSettings,
} from "../systems/audio-system";
import type { UniformRoll } from "../systems/particle-system";
import type { InstalledTerrain } from "../terrain/terrain-system";
import { AudioControlCadence } from "./audio-control-cadence";
import { withSilentLocalModelAudio } from "./local-model-audio";
import type { LocalSceneModelOwnerId } from "./owner-ids";
import { completePresentationOperations } from "./presentation-teardown";
import type { ResolvedSceneInterestTarget } from "./scene-target";
import type { AudioListenerPlacement } from "./types";

export interface SpatialAudioAndAmbientContext {
	readonly audioDevice: AudioDevice;
	readonly soundTableSource: SoundTableSource;
	readonly roll?: UniformRoll;
	readonly clock: () => number;
	readonly isDestroyed: () => boolean;
	readonly onContentFailure: (error: Error) => void;
	readonly onPresentationFailure: (cause: unknown) => void;
	readonly originOf: (target: BehaviorTarget) => SceneVector3 | null;
	readonly hasSkyTarget: (targetId: BehaviorTargetId) => boolean;
	readonly localModelOwnerForNode: (
		nodeId: SceneNodeId,
	) => LocalSceneModelOwnerId | null;
	readonly resolvedSceneTarget: () => ResolvedSceneInterestTarget | null;
	readonly getTerrainInstallationRevision: () => number;
	readonly listInstalledTerrain: () => Iterable<InstalledTerrain>;
	readonly getEnvCellSeenOutside: (envCellId: EnvCellId) => boolean | null;
}

/**
 * Owns spatial audio playback, listener state, sound tables, and terrain ambient bakes/scans.
 */
export class SpatialAudioAndAmbientCoordinator {
	readonly #context: SpatialAudioAndAmbientContext;
	readonly #soundTables: SoundTableRepository;
	/** Sound table installed by each behaviour target's setup, for `SoundTable` key resolution. */
	readonly #targetSoundTables = new Map<BehaviorTargetId, DecodedSoundTable>();
	readonly #audio: AudioSystem;
	readonly #ambient: AmbientSystem;
	/** Bounded owner for live ambient-weight and voice-placement control work. */
	readonly #audioControlCadence = new AudioControlCadence(
		SHARED_FRONTEND_TUNING.audio.controlUpdateIntervalSeconds,
	);
	/** Where ambience is centred; the listener's own position, kept for the scan and for playback. */
	#audioListenerPosition: SceneVector3 = sceneVector3([0, 0, 0]);
	/** Environment cell the listener occupies, or null for outdoor terrain. */
	#audioListenerEnvCellId: EnvCellId | null = null;
	/** Whether the current mode owns listener/audio presentation for this frame. */
	#audioListenerEnabled = false;
	/** Region ambient facts, installed once per active region; `null` before one is installed. */
	#ambientRegion: AmbientRegionResolution | null = null;
	/** Baked sound-authoring ground per installed landblock, reconciled by terrain revision. */
	readonly #ambientBakes = new AmbientBakeRegistry();
	/** Hoisted so the every-frame reconcile check allocates nothing. */
	readonly #listAmbientTerrain = () => this.#ambientTerrainBlocks();
	/** Staged ambient sound tables, keyed as the descriptors name them. */
	readonly #ambientSoundTables = new Map<DatAssetId, DecodedSoundTable>();
	/** Handles retaining staged ambient sound tables; released on new region or runtime destruction. */
	readonly #ambientSoundTableHandles = new Map<
		DatAssetId,
		PreparedAssetHandle<DecodedSoundTable>
	>();
	/**
	 * Scan cell the last ambient schedule refresh ran from, floored on the authored terrain cell
	 * size. Cell-sized rather than landblock-sized: the ambient radius is 120 m against a 192 m
	 * block, so a landblock trigger would let the listener cross most of the audible field between
	 * refreshes. Compared as numbers so the per-frame check allocates nothing.
	 */
	#ambientScanCellX: number | null = null;
	#ambientScanCellZ: number | null = null;
	/** EnvCell the last ambient refresh ran under, part of the same numeric trigger. */
	#ambientScanEnvCellId: EnvCellId | null = null;

	constructor(context: SpatialAudioAndAmbientContext) {
		this.#context = context;
		this.#soundTables = new SoundTableRepository(context.soundTableSource);
		this.#audio = new AudioSystem(
			context.audioDevice,
			Math.random,
			SHARED_FRONTEND_TUNING.audio.maximumSimultaneousVoices,
			context.clock,
			SHARED_FRONTEND_TUNING.audio.maximumWarmupReplaySeconds,
			(cause) => {
				if (isContentFailure(cause))
					context.onContentFailure(
						new Error("Sound unavailable; playback omitted.", { cause }),
					);
				else context.onPresentationFailure(cause);
			},
		);
		this.#ambient = new AmbientSystem({
			// Pure wiring: the ambient system owns the buffer, what share means, and the indoor
			// gate; the runtime only knows where the baked terrain lives.
			accumulateWeights: (outWeights) =>
				accumulateAmbientWeights(
					this.#audioListenerPosition,
					this.#ambientBakes.blocks(),
					outWeights,
				),
			listenerHearsOutdoors: () => this.#ambientListenerSeenOutside(),
			listenerPosition: () => this.#audioListenerPosition,
			play: (trigger) =>
				this.#audioListenerEnabled ? this.#audio.trigger(trigger) : "inaudible",
			resolveSound: (soundTableId, soundType) =>
				this.#resolveAmbientSound(soundTableId, soundType),
			roll: context.roll ?? Math.random,
		});
	}

	get soundTables(): SoundTableRepository {
		return this.#soundTables;
	}

	get listenerEnabled(): boolean {
		return this.#audioListenerEnabled;
	}

	setTargetSoundTable(
		targetId: BehaviorTargetId,
		soundTable: DecodedSoundTable,
	): void {
		this.#targetSoundTables.set(targetId, soundTable);
	}

	deleteTargetSoundTable(targetId: BehaviorTargetId): void {
		this.#targetSoundTables.delete(targetId);
	}

	triggerListenerLocked(
		soundId: DatAssetId,
		volume?: number,
		probability?: number,
	): void {
		this.#audio.triggerListenerLocked(soundId, volume, probability);
	}

	/** Shared audio sink for both script domains; scale ownership is their only distinction. */
	createBehaviorAudioCommands(): BehaviorConsumers["audio"] {
		const audio: BehaviorConsumers["audio"] = {
			playSound: (target, sound) => {
				if (!this.#audioListenerEnabled) return "suppressed";
				// Retail samples the emitting node once. The voice follows the listener from that
				// fixed point rather than following later movement of the emitter.
				const origin = this.#context.originOf(target);
				if (origin === null) return "unprepared";
				const skyTarget = this.#context.hasSkyTarget(target.targetId);
				const outcome = this.#audio.trigger({
					// Authored hook sounds are effect sounds: `PlaySoundA` gates on
					// `effect_sounds_enabled` and passes `is_ambient = 0`.
					category: "effect",
					probability: sound.probability,
					soundId: sound.soundId,
					source: skyTarget
						? {
								mode: "world-live",
								position: origin,
								volume: () => (this.#skyAudioEnabled() ? sound.volume : 0),
							}
						: { mode: "world", position: origin, volume: sound.volume },
				});
				return outcome === "played" ? "played" : "suppressed";
			},
			playSoundTableKey: (target, soundType) =>
				this.playSoundTableKey(target, soundType, null),
		};
		return withSilentLocalModelAudio(audio, (target) => {
			const nodeId = sceneNodeIdOf(target.targetId);
			return nodeId === null
				? null
				: this.#context.localModelOwnerForNode(nodeId);
		});
	}

	/** Resolve authored choice/probability once; packet sounds supply their own gain source. */
	playSoundTableKey(
		target: Parameters<BehaviorConsumers["audio"]["playSoundTableKey"]>[0],
		soundType: number,
		packet: {
			readonly volume: number;
			readonly canReplay: () => boolean;
		} | null,
	): ReturnType<BehaviorConsumers["audio"]["playSoundTableKey"]> {
		if (!this.#audioListenerEnabled) return "suppressed";
		const candidates = this.#targetSoundTables
			.get(target.targetId)
			?.entries.get(soundType);
		if (!candidates) return "unprepared";
		const candidate = selectSoundCandidate(candidates, Math.random());
		if (!candidate) return "unprepared";
		const origin = this.#context.originOf(target);
		if (origin === null) return "unprepared";
		const outcome = this.#audio.trigger({
			category: "effect",
			probability: candidate.probability,
			soundId: candidate.soundId,
			source: {
				mode: "world",
				position: origin,
				volume: packet === null ? candidate.volume : packet.volume,
			},
			canReplay: packet === null ? undefined : packet.canReplay,
		});
		return outcome === "played" ? "played" : "suppressed";
	}

	/**
	 * Place the audio listener, in canonical scene space.
	 *
	 * Passing `null` withdraws listener ownership and fades existing voices while a mode is in
	 * portal-space staging. Otherwise this is deliberately a frontend input rather than something
	 * derived from the primary camera. Where
	 * the ears are is a client decision: a game client puts them on the player, while the explorer
	 * flies a free camera and may want them somewhere else entirely. The runtime owns the frame
	 * conversion and the retail spatial maths, not the choice.
	 */
	setAudioListener(placement: AudioListenerPlacement | null): void {
		if (placement === null) {
			this.#audioListenerEnabled = false;
			this.#audioListenerPosition = sceneVector3([0, 0, 0]);
			this.#audioListenerEnvCellId = null;
			this.#audio.silence();
			return;
		}
		const { envCellId, position, rotation } = placement;
		if (
			!position.every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Audio listener placement must be finite.");
		}
		this.#audioListenerPosition = position;
		this.#audioListenerEnvCellId = envCellId;
		const { w, x, y, z } = rotation;
		this.#audio.setListener({
			position,
			// First column of the rotation, which is its local +X: the listener's right hand.
			right: renderVector3([
				1 - 2 * (y * y + z * z),
				2 * (x * y + w * z),
				2 * (x * z - w * y),
			]),
		});
		this.#audioListenerEnabled = true;
	}

	/**
	 * Install the active region's ambient facts and stage every sound table they can reach.
	 *
	 * Ambience is selected by the ground rather than by a hook, so nothing else will pull these
	 * tables in; without staging them here every scheduled sound resolves to nothing.
	 */
	async installAmbientRegion(facts: AmbientRegionFacts): Promise<void> {
		this.#ambientRegion = createAmbientRegionResolution(facts);
		// Baked entries and scheduled slots carry the previous region's slot ids, so both go with
		// the region; a bed still playing fades out through its supplier reading zero.
		this.#ambientBakes.clear();
		this.#ambient.resetForRegion(this.#ambientRegion.descriptorsBySlot.length);
		this.#ambientScanCellX = null;
		this.#ambientScanCellZ = null;
		this.#ambientScanEnvCellId = null;
		for (const handle of this.#ambientSoundTableHandles.values()) {
			handle.release();
		}
		this.#ambientSoundTableHandles.clear();
		this.#ambientSoundTables.clear();

		const staged = await this.#soundTables.acquireAvailable(
			ambientSoundTableIds(facts),
		);
		if (this.#context.isDestroyed()) {
			for (const handle of staged.values()) handle?.release();
			return;
		}
		for (const [soundTableId, handle] of staged) {
			if (handle === null) continue;
			this.#ambientSoundTableHandles.set(soundTableId, handle);
			this.#ambientSoundTables.set(soundTableId, handle.asset);
		}
	}

	/**
	 * Apply user audio settings, one volume per retail sound category.
	 *
	 * A volume of zero is the same observable behaviour as retail's per-category enable flag being
	 * off, so no separate flag exists.
	 */
	setAudioSettings(settings: AudioSettings): void {
		this.#audio.setSettings(settings);
	}

	/** Advance terrain ambient scans, live weights, and spatial voice placements for one render frame. */
	advanceFrameAudio(timeSeconds: number): void {
		if (!this.#audioListenerEnabled) return;
		const ambientRefreshed = this.#refreshAmbient(timeSeconds);
		const updateAudioControl = this.#audioControlCadence.shouldUpdate(
			timeSeconds,
			ambientRefreshed,
		);
		if (updateAudioControl) this.#ambient.updateLiveWeights();
		this.#ambient.advance(timeSeconds);
		// After ambience so a voice admitted on this control tick is placed against the same pose.
		if (updateAudioControl) this.#audio.updatePlacements();
	}

	retryFailed(): void {
		this.#soundTables.retryFailed();
	}

	getDiagnostics() {
		return {
			audio: this.#audio.getDiagnostics(),
			ambient: this.#ambient.getDiagnostics(),
			ambientBakes: this.#ambientBakes.getDiagnostics(),
		};
	}

	clearTargetSoundTables(): void {
		this.#targetSoundTables.clear();
	}

	destroySoundTables(): void {
		this.#soundTables.destroy();
	}

	clearAmbientState(): void {
		this.#ambientSoundTableHandles.clear();
		this.#ambientSoundTables.clear();
	}

	releaseAmbientHandles(): void {
		completePresentationOperations(
			[...this.#ambientSoundTableHandles.values()].map(
				(handle) => () => handle.release(),
			),
		);
	}

	destroyAudio(): void {
		this.#audio.destroy();
	}

	/** Resolve one ambient descriptor's `SoundType` against its staged table. */
	#resolveAmbientSound(soundTableId: DatAssetId, soundType: number) {
		const table = this.#ambientSoundTables.get(soundTableId);
		const candidates = table?.entries.get(soundType);
		if (!candidates) return null;
		const candidate = selectSoundCandidate(candidates, Math.random());
		if (!candidate) return null;
		// The candidate's authored volume is deliberately dropped: retail's ambient path plays at
		// the descriptor's volume and reads only the candidate's probability.
		return { probability: candidate.probability, soundId: candidate.soundId };
	}

	/**
	 * Re-scan the surrounding terrain when the listener changes cell.
	 *
	 * Retail rebuilds on cell transition (retail sounds initialization takes a `Position`),
	 * and the scan walks every cell of every installed landblock, so running it per frame
	 * would be pure waste: ambience cannot change while the listener stays put.
	 *
	 * When the listener is inside an EnvCell whose authored flags do not include `SeenOutside`
	 * (EnvCell flag 0x01), outdoor surface terrain ambience is silenced.
	 */
	#refreshAmbient(timeSeconds: number): boolean {
		const region = this.#ambientRegion;
		if (!region) return false;
		const position = this.#audioListenerPosition;
		// Terrain first: landblocks stream in after the first refresh, and a listener standing
		// still while its surroundings arrive would otherwise never hear them.
		const rebaked = this.#ambientBakes.reconcile(
			this.#context.getTerrainInstallationRevision(),
			this.#listAmbientTerrain,
			region.resolve,
		);
		// The scan-cell size is the authored terrain cell size, read from the terrain in hand
		// rather than restated as a constant. Before any terrain installs there is nothing to scan
		// and the revision diff, not the cell trigger, fires the first real refresh.
		const cellSize = this.#ambientBakes.cellSize;
		const cellX = cellSize === null ? 0 : Math.floor(position[0] / cellSize);
		const cellZ = cellSize === null ? 0 : Math.floor(position[2] / cellSize);
		if (
			!rebaked &&
			cellX === this.#ambientScanCellX &&
			cellZ === this.#ambientScanCellZ &&
			this.#audioListenerEnvCellId === this.#ambientScanEnvCellId
		) {
			return false;
		}
		this.#ambientScanCellX = cellX;
		this.#ambientScanCellZ = cellZ;
		this.#ambientScanEnvCellId = this.#audioListenerEnvCellId;

		// Skipping the walk indoors is an optimization only; the ambient system enforces the same
		// gate through its `listenerHearsOutdoors` dependency, so the two cadences cannot diverge.
		const scanResult = !this.#ambientListenerSeenOutside()
			? EMPTY_AMBIENT_SCAN_RESULT
			: scanAmbientSources(
					position,
					this.#ambientBakes.blocks(),
					region.descriptorsBySlot,
				);

		this.#ambient.refresh(scanResult, timeSeconds);
		return true;
	}

	/**
	 * Whether outdoor terrain ambience reaches the listener where it stands.
	 *
	 * Inside an EnvCell whose authored flags lack `SeenOutside` (flag 0x01), surface ambience
	 * is silenced. The ambient system consumes this through one dependency for both of its
	 * cadences; the runtime additionally reads it to skip building scans indoors.
	 */
	#ambientListenerSeenOutside(): boolean {
		return this.#audioListenerEnvCellId !== null
			? this.#context.getEnvCellSeenOutside(this.#audioListenerEnvCellId) !==
					false
			: true;
	}

	/**
	 * Whether sky-authored audio is eligible in the accepted static-content context.
	 *
	 * RETAIL DIVERGENCE: retail keeps weather Setups alive indoors and therefore keeps
	 * dispatching their sounds; retail sky-object creation gates only on the weather option,
	 * while retail sky drawing applies `is_player_outside` only to the after-landscape draw.
	 * Removing this gate restores invisible rain and thunder in dungeons. The shipped-region
	 * census found 92 weather objects in eight Rainy day groups, with all audible sky behavior
	 * confined to the three weather Setup/script families `0x02000588`, `0x02000589`, and
	 * `0x02000BA6`; the sole celestial script produces particles and no sound.
	 */
	#skyAudioEnabled(): boolean {
		const target = this.#context.resolvedSceneTarget();
		// No accepted target is not evidence of dungeon context. Modes may install regional sky
		// before their first scene request, so only the authoritative dungeon classification mutes it.
		return target === null || target.kind === "outdoor";
	}

	/** Installed terrain with identity, expressed in the scene frame the bake retains. */
	*#ambientTerrainBlocks(): Generator<InstalledAmbientTerrain> {
		for (const {
			generation,
			landblockId,
		} of this.#context.listInstalledTerrain()) {
			const origin = createLandblockWorldOrigin(landblockId);
			yield {
				block: {
					gridSize: generation.gridSize,
					heights: generation.heights,
					origin: sceneVector3([origin.x, origin.y, origin.z]),
					terrainSamples: generation.terrainSamples,
					tileSize: generation.tileSize,
				},
				landblockId,
			};
		}
	}
}
