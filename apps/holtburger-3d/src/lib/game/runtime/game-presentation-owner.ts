import type { HostPresentationResources } from "./host-presentation-assets";
import { PresentationTeardownStack } from "./presentation-teardown";
import { ActiveRegionHostSource } from "../../assets/active-region-host-source";
import { AudioHostSource } from "../../assets/audio-host-source";
import { LandblockProfileHostSource } from "../../assets/landblock-profile-host-source";
import { CachedLandblockProfileSource } from "../../assets/landblock-profile-source";
import { LandblockSourceHostBatch } from "../../assets/landblock-source-host-batch";
import { PhysicsScriptTableHostSource } from "../../assets/physics-script-table-host-source";
import { SkyHostSource } from "../../assets/sky-host-source";
import { SoundTableHostSource } from "../../assets/sound-table-host-source";
import { WebAudioDevice } from "../../assets/web-audio-device";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { HostTransport } from "../../host/host-transport";
import { StandardCommitPipeline } from "../commit/pipeline";
import { WebGL2Device } from "../renderer/webgl2-device";
import type { FrameSettings } from "../renderer/renderer";
import { ActiveRegionStaticDetailOwner } from "../resolution/active-region-static-detail";
import { RuntimeTickProfiler } from "./runtime-tick-profiler";
import { GamePresentationRuntime } from "./game-presentation-runtime";
import type { TextureFilteringCapabilities } from "../renderer/texture-filtering-policy";
import type { PortalWarpDriveTuning } from "../renderer/portal-warp-drive-tuning";
import type { LandblockSourceBatchSource } from "../../assets/landblock-source-batch";
import type { AmbientRegionFacts } from "../systems/ambient-region";
import {
	loadPortalTransitionAssets,
	type PortalTransitionAssets,
} from "../../client/portal-transition-assets";

/** Explicit browser dependencies for one imperative presentation composition. */
export interface GamePresentationOwnerDependencies {
	readonly canvas: HTMLCanvasElement;
	readonly hostTransport: HostTransport;
	/** Borrowed app-owned content assets; world construction and rollback never destroy them. */
	readonly presentationResources: HostPresentationResources;
	readonly audioTuning: GamePresentationAudioTuning;
	/** Mode-owned initial display policy forwarded to the shared runtime. */
	readonly frameSettings: FrameSettings;
	/** Mode-owned portal transition look forwarded unchanged into the renderer device. */
	readonly portalWarpDriveTuning: PortalWarpDriveTuning;
	/** Optional lifecycle signal; construction stops between expensive host/GPU steps when aborted. */
	readonly signal?: AbortSignal;
	/** Optional frame profiler; a diagnostics-oriented frontend may inject one. */
	readonly tickProfiler?: RuntimeTickProfiler;
	/** Injectable for focused browser tests without changing the runtime's audio policy. */
	readonly audioContextFactory?: () => AudioContext;
}

/** Audio adapter tuning supplied by the composing frontend rather than chosen by this owner. */
interface GamePresentationAudioTuning {
	readonly placementSmoothingSeconds: number;
	readonly loudnessCurveExponent: number;
}

/**
 * Owns world-scene and renderer lifetime while borrowing app-owned content assets.
 *
 * This owner has no Svelte state and makes no camera, scene-interest, or presentation-policy
 * decisions. Its public values are immutable composition results; the runtime remains imperative
 * and frame-hot facts stay with the frontend that drives it.
 */
export class GamePresentationOwner {
	readonly activeRegion: ActiveRegionSource;
	readonly profileSource: CachedLandblockProfileSource;
	readonly device: WebGL2Device;
	readonly runtime: GamePresentationRuntime;
	/** Required authored portal closure retained for every client/Explorer transition. */
	readonly portalTransitionAssets: PortalTransitionAssets;
	readonly textureFilteringCapabilities: TextureFilteringCapabilities;
	readonly #teardown: PresentationTeardownStack;
	/** Browser output control retained alongside the teardown-owned audio device. */
	readonly #audioDevice: WebAudioDevice;
	#retirement: Promise<void> | null = null;

	private constructor(resources: {
		readonly activeRegion: ActiveRegionSource;
		readonly activeRegionSource: ActiveRegionHostSource;
		readonly commitPipeline: StandardCommitPipeline;
		readonly device: WebGL2Device;
		readonly soundTableSource: SoundTableHostSource;
		readonly audioDevice: WebAudioDevice;
		readonly audioContext: AudioContext;
		readonly profileHostSource: LandblockProfileHostSource;
		readonly profileSource: CachedLandblockProfileSource;
		readonly portalTransitionAssets: PortalTransitionAssets;
		readonly runtime: GamePresentationRuntime;
		readonly skySource: SkyHostSource;
		readonly staticDetailOwner: ActiveRegionStaticDetailOwner;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities;
	}) {
		this.#audioDevice = resources.audioDevice;
		this.activeRegion = resources.activeRegion;
		this.device = resources.device;
		this.profileSource = resources.profileSource;
		this.runtime = resources.runtime;
		this.portalTransitionAssets = resources.portalTransitionAssets;
		this.textureFilteringCapabilities = resources.textureFilteringCapabilities;
		this.#teardown = createPresentationTeardown(resources);
	}

	/** Set browser output loudness independently of runtime sound placement. */
	setOutputVolume(volume: number): void {
		this.#audioDevice.setOutputVolume(volume);
	}

	/** Build and install one complete active-region presentation composition. */
	static async build(
		dependencies: GamePresentationOwnerDependencies,
	): Promise<GamePresentationOwner> {
		const {
			canvas,
			hostTransport,
			presentationResources,
			audioTuning,
			frameSettings,
			portalWarpDriveTuning,
			signal,
			tickProfiler,
			audioContextFactory = () => new AudioContext(),
		} = dependencies;
		let activeRegionSource: ActiveRegionHostSource | undefined;
		let profileHostSource: LandblockProfileHostSource | undefined;
		let profileSource: CachedLandblockProfileSource | undefined;
		let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
		let skySource: SkyHostSource | undefined;
		let device: WebGL2Device | undefined;
		let commitPipeline: StandardCommitPipeline | undefined;
		let runtime: GamePresentationRuntime | undefined;
		let soundTableSource: SoundTableHostSource | undefined;
		let audioDevice: WebAudioDevice | undefined;
		let audioContext: AudioContext | undefined;
		let portalTransitionAssets: PortalTransitionAssets | undefined;
		try {
			throwIfPresentationConstructionAborted(signal);
			activeRegionSource = ActiveRegionHostSource.build(hostTransport);
			const activeRegion = await activeRegionSource.load();
			throwIfPresentationConstructionAborted(signal);
			const sourceBatch: LandblockSourceBatchSource =
				LandblockSourceHostBatch.build(activeRegion, hostTransport);
			profileHostSource = LandblockProfileHostSource.build(hostTransport);
			profileSource = new CachedLandblockProfileSource(profileHostSource);
			const texturePixelSource = presentationResources.texturePixelSource;
			staticDetailOwner = new ActiveRegionStaticDetailOwner(texturePixelSource);
			const staticDetailBinding = await staticDetailOwner.install(activeRegion);
			throwIfPresentationConstructionAborted(signal);
			device = await WebGL2Device.build(canvas, portalWarpDriveTuning);
			throwIfPresentationConstructionAborted(signal);
			const textureFilteringCapabilities =
				device.getTextureFilteringCapabilities();
			commitPipeline = await StandardCommitPipeline.build({ sourceBatch });
			throwIfPresentationConstructionAborted(signal);
			soundTableSource = SoundTableHostSource.build(hostTransport);
			audioContext = audioContextFactory();
			audioDevice = new WebAudioDevice(
				audioContext,
				AudioHostSource.build(hostTransport),
				audioTuning.placementSmoothingSeconds,
				audioTuning.loudnessCurveExponent,
			);
			portalTransitionAssets = await loadPortalTransitionAssets({
				audio: audioDevice,
				animation: presentationResources.animationSource,
				setupVisual: presentationResources.setupVisualSource,
				soundTable: soundTableSource,
			});
			throwIfPresentationConstructionAborted(signal);
			runtime = await GamePresentationRuntime.build(
				device,
				commitPipeline,
				presentationResources.assets,
				PhysicsScriptTableHostSource.build(hostTransport),
				audioDevice,
				soundTableSource,
				presentationResources.particleMeshSource(),
				frameSettings,
				undefined,
				tickProfiler,
			);
			throwIfPresentationConstructionAborted(signal);
			if (portalTransitionAssets === undefined) {
				throw new Error("Portal transition assets were not prepared.");
			}
			await runtime.installPortalTransitionAssets(portalTransitionAssets);
			throwIfPresentationConstructionAborted(signal);
			runtime.installActiveRegionStaticDetails(staticDetailBinding);
			const ambient = ambientRegionFacts(activeRegion);
			if (ambient !== null) {
				throwIfPresentationConstructionAborted(signal);
				await runtime.installAmbientRegion(ambient);
			}
			skySource = new SkyHostSource(hostTransport);
			throwIfPresentationConstructionAborted(signal);
			const sky = await skySource.loadSkySource();
			throwIfPresentationConstructionAborted(signal);
			await runtime.installSky(sky);
			throwIfPresentationConstructionAborted(signal);
			return new GamePresentationOwner({
				activeRegion,
				activeRegionSource,
				commitPipeline,
				device,
				profileHostSource,
				profileSource,
				portalTransitionAssets,
				soundTableSource,
				audioDevice,
				audioContext,
				runtime,
				skySource,
				staticDetailOwner,
				textureFilteringCapabilities,
			});
		} catch (error) {
			try {
				await destroyPresentationParts({
					activeRegionSource,
					commitPipeline,
					device,
					soundTableSource,
					audioDevice,
					audioContext,
					profileHostSource,
					profileSource,
					runtime,
					skySource,
					staticDetailOwner,
				});
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Presentation startup and cleanup both failed.",
					{ cause: cleanupError },
				);
			}
			throw error;
		}
	}

	/** Tear down in dependency order; repeated calls are harmless for unmount/error races. */
	destroy(): Promise<void> {
		return (this.#retirement ??= this.#teardown.close());
	}
}

function throwIfPresentationConstructionAborted(
	signal: AbortSignal | undefined,
): void {
	if (!signal?.aborted) return;
	const error = new Error("Presentation construction was cancelled.");
	error.name = "AbortError";
	throw error;
}

interface PresentationParts {
	readonly activeRegionSource?: ActiveRegionHostSource;
	readonly commitPipeline?: StandardCommitPipeline;
	readonly device?: WebGL2Device;
	readonly soundTableSource?: SoundTableHostSource;
	readonly audioDevice?: WebAudioDevice;
	/** The world composition creates this context; the audio device only borrows it. */
	readonly audioContext?: AudioContext;
	readonly profileHostSource?: LandblockProfileHostSource;
	readonly profileSource?: CachedLandblockProfileSource;
	readonly runtime?: GamePresentationRuntime;
	readonly skySource?: SkyHostSource;
	readonly staticDetailOwner?: ActiveRegionStaticDetailOwner;
}

/** Preserve the existing runtime's ordered teardown even when startup fails halfway through. */
async function destroyPresentationParts(
	parts: PresentationParts,
): Promise<void> {
	await createPresentationTeardown(parts).close();
}

function createPresentationTeardown(
	parts: PresentationParts,
): PresentationTeardownStack {
	const stack = new PresentationTeardownStack();
	// Register in acquisition order; close() releases in dependency-safe reverse order.
	stack.add(
		"active-region-source",
		parts.activeRegionSource?.destroy.bind(parts.activeRegionSource),
	);
	stack.add(
		"profile-host-source",
		parts.profileHostSource?.destroy.bind(parts.profileHostSource),
	);
	stack.add(
		"profile-source",
		parts.profileSource?.destroy.bind(parts.profileSource),
	);
	stack.add(
		"static-detail-owner",
		parts.staticDetailOwner?.teardown.bind(parts.staticDetailOwner),
	);
	stack.add("webgl-device", parts.device?.destroy.bind(parts.device));
	stack.add(
		"sound-table-source",
		parts.soundTableSource?.destroy.bind(parts.soundTableSource),
	);
	// Retire voices/device sources before closing their world-owned browser context.
	stack.add(
		"audio-context",
		parts.audioContext?.close.bind(parts.audioContext),
	);
	stack.add("audio-device", parts.audioDevice?.destroy.bind(parts.audioDevice));
	stack.add(
		"commit-pipeline",
		parts.commitPipeline?.destroy.bind(parts.commitPipeline),
	);
	stack.add("presentation-runtime", parts.runtime?.destroy.bind(parts.runtime));
	stack.add("sky-source", parts.skySource?.destroy.bind(parts.skySource));
	return stack;
}

/** Project immutable regional ambience facts once, before the runtime begins ticking. */
function ambientRegionFacts(
	activeRegion: ActiveRegionSource,
): AmbientRegionFacts | null {
	if (!activeRegion.data.sound || !activeRegion.data.scenes) return null;
	return {
		sceneTypes: activeRegion.data.scenes.types.map((type) => ({
			soundTableIndex: type.soundTableIndex,
		})),
		tables: activeRegion.data.sound.tables.map((table) => ({
			soundTableId: table.soundTableId,
			sounds: table.sounds,
		})),
		terrainTypes:
			activeRegion.data.terrain?.types.map((type) => ({
				sceneTypes: type.sceneTypes,
			})) ?? [],
	};
}
