import { AnimationHostSource } from "../../assets/animation-host-source";
import { ActiveRegionHostSource } from "../../assets/active-region-host-source";
import { AudioHostSource } from "../../assets/audio-host-source";
import { SetupVisualHostSource } from "../../assets/setup-visual-host-source";
import { LandblockProfileHostSource } from "../../assets/landblock-profile-host-source";
import { CachedLandblockProfileSource } from "../../assets/landblock-profile-source";
import { LandblockSourceHostBatch } from "../../assets/landblock-source-host-batch";
import { ParticleEmitterHostSource } from "../../assets/particle-emitter-host-source";
import { ParticleMeshHostSource } from "../../assets/particle-mesh-host-source";
import { PhysicsScriptHostSource } from "../../assets/physics-script-host-source";
import { PhysicsScriptTableHostSource } from "../../assets/physics-script-table-host-source";
import { SkyHostSource } from "../../assets/sky-host-source";
import { SoundTableHostSource } from "../../assets/sound-table-host-source";
import { TexturePixelHostSource } from "../../assets/texture-pixel-host-source";
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
 * Owns the shared static-content and renderer lifetime used by desktop frontends.
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
	#destroyed = false;

	private constructor(resources: {
		readonly activeRegion: ActiveRegionSource;
		readonly activeRegionSource: ActiveRegionHostSource;
		readonly commitPipeline: StandardCommitPipeline;
		readonly device: WebGL2Device;
		readonly setupVisualSource: SetupVisualHostSource;
		readonly animationSource: AnimationHostSource;
		readonly soundTableSource: SoundTableHostSource;
		readonly audioDevice: WebAudioDevice;
		readonly profileHostSource: LandblockProfileHostSource;
		readonly profileSource: CachedLandblockProfileSource;
		readonly portalTransitionAssets: PortalTransitionAssets;
		readonly runtime: GamePresentationRuntime;
		readonly skySource: SkyHostSource;
		readonly staticDetailOwner: ActiveRegionStaticDetailOwner;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities;
	}) {
		this.activeRegion = resources.activeRegion;
		this.device = resources.device;
		this.profileSource = resources.profileSource;
		this.runtime = resources.runtime;
		this.portalTransitionAssets = resources.portalTransitionAssets;
		this.textureFilteringCapabilities = resources.textureFilteringCapabilities;
		this.#teardown = createPresentationTeardown(resources);
	}

	/** Build and install one complete active-region presentation composition. */
	static async build(
		dependencies: GamePresentationOwnerDependencies,
	): Promise<GamePresentationOwner> {
		const {
			canvas,
			hostTransport,
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
		let setupVisualSource: SetupVisualHostSource | undefined;
		let animationSource: AnimationHostSource | undefined;
		let soundTableSource: SoundTableHostSource | undefined;
		let audioDevice: WebAudioDevice | undefined;
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
			const texturePixelSource = TexturePixelHostSource.build(hostTransport);
			staticDetailOwner = new ActiveRegionStaticDetailOwner(texturePixelSource);
			const staticDetailBinding = await staticDetailOwner.install(activeRegion);
			throwIfPresentationConstructionAborted(signal);
			device = await WebGL2Device.build(canvas, portalWarpDriveTuning);
			throwIfPresentationConstructionAborted(signal);
			const textureFilteringCapabilities =
				device.getTextureFilteringCapabilities();
			commitPipeline = await StandardCommitPipeline.build({ sourceBatch });
			throwIfPresentationConstructionAborted(signal);
			setupVisualSource = new SetupVisualHostSource(hostTransport);
			animationSource = AnimationHostSource.build(hostTransport);
			soundTableSource = SoundTableHostSource.build(hostTransport);
			audioDevice = new WebAudioDevice(
				audioContextFactory(),
				AudioHostSource.build(hostTransport),
				audioTuning.placementSmoothingSeconds,
				audioTuning.loudnessCurveExponent,
			);
			portalTransitionAssets = await loadPortalTransitionAssets({
				audio: audioDevice,
				animation: animationSource,
				setupVisual: setupVisualSource,
				soundTable: soundTableSource,
			});
			throwIfPresentationConstructionAborted(signal);
			runtime = await GamePresentationRuntime.build(
				device,
				commitPipeline,
				texturePixelSource,
				animationSource,
				PhysicsScriptHostSource.build(hostTransport),
				PhysicsScriptTableHostSource.build(hostTransport),
				audioDevice,
				ParticleEmitterHostSource.build(hostTransport),
				soundTableSource,
				ParticleMeshHostSource.build(hostTransport),
				setupVisualSource,
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
				setupVisualSource,
				animationSource,
				soundTableSource,
				audioDevice,
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
					setupVisualSource,
					animationSource,
					soundTableSource,
					audioDevice,
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
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		await this.#teardown.close();
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
	readonly setupVisualSource?: SetupVisualHostSource;
	readonly animationSource?: AnimationHostSource;
	readonly soundTableSource?: SoundTableHostSource;
	readonly audioDevice?: WebAudioDevice;
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

type TeardownOperation = () => void | Promise<void>;

/**
 * Reverse-order cleanup that attempts every release and reports all failures together.
 *
 * Startup is deliberately progressive, so a failed device/runtime step can leave several earlier
 * resources alive. Nested `finally` blocks guarantee progress but hide later failures; this stack
 * keeps the same ordering while making the complete shutdown result observable.
 */
export class PresentationTeardownStack {
	readonly #operations: {
		readonly label: string;
		readonly release: TeardownOperation;
	}[] = [];
	#closed = false;

	add(label: string, release: TeardownOperation | undefined): void {
		if (release === undefined) return;
		this.#operations.push({ label, release });
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const failures: unknown[] = [];
		const labels: string[] = [];
		for (const operation of [...this.#operations].reverse()) {
			try {
				await operation.release();
			} catch (error) {
				failures.push(error);
				labels.push(operation.label);
			}
		}
		if (failures.length === 0) return;
		throw new AggregateError(
			failures,
			`Presentation teardown failed for: ${labels.join(", ")}.`,
		);
	}
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
		"setup-visual-source",
		parts.setupVisualSource?.destroy.bind(parts.setupVisualSource),
	);
	stack.add(
		"animation-source",
		parts.animationSource?.destroy.bind(parts.animationSource),
	);
	stack.add(
		"sound-table-source",
		parts.soundTableSource?.destroy.bind(parts.soundTableSource),
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
