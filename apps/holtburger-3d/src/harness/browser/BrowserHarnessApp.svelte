<script lang="ts">
	import { onMount } from "svelte";
	import {
		EXPLORER_CAMERA_FRAMING,
		resolveExplorerOutdoorFocusPose,
	} from "../../explorer/explorer-camera-framing";
	import { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
	import type { HttpLandblockSourceBatchDiagnostic } from "../../lib/assets/http-landblock-content-source";
	import { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
	import { SyntheticBlendedBuildingPipeline } from "./synthetic-blended-building-pipeline";
	import { SyntheticInstancedObjectPipeline } from "./synthetic-instanced-object-pipeline";
	import {
		DynamicOnlyLandblockSource,
		WithoutAuthoredDynamicsLandblockSource,
	} from "./dynamic-only-landblock-source";
	import type { EnvCellId, LandblockId } from "../../lib/game/game-types";
	import {
		createLandblockWorldOrigin,
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
	} from "../../lib/game/landblocks";
	import { createCameraRotationRadians } from "../../lib/game/math/camera-orientation";
	import { Vec3 } from "../../lib/game/math/types";
	import {
		WebGL2Device,
		type WebGL2ContextLossPolicyProbe,
		type PortalTargetCapabilityProbe,
	} from "../../lib/game/renderer/webgl2-device";
	import type { WebGL2PortalSubstrateFixtureResult } from "../../lib/game/renderer/webgl2-portal-substrate-fixture";
	import type { WebGL2HybridPortalExecutionFixtureResult } from "../../lib/game/renderer/webgl2-hybrid-portal-executor-fixture";
	import type { WebGL2InternalPortalExecutionFixtureResult } from "../../lib/game/renderer/webgl2-internal-portal-executor-fixture";
	import {
		GameRuntime,
		type StaticObjectLayerRuntimeDiagnostics,
		type StaticObjectRuntimeDiagnostics,
	} from "../../lib/game/runtime/game-runtime";
	import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
	import { ActiveRegionStaticDetailOwner } from "../../lib/game/resolution/active-region-static-detail";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSelectionMetrics,
		type FrameSettings,
		type RendererFrameProfile,
	} from "../../lib/game/renderer/renderer";
	import type {
		PortalExecutionProbeResult,
		PortalRenderGraphProbeResult,
		WebGL2Renderer,
	} from "../../lib/game/renderer/webgl2-renderer";
	import {
		isTextureFilteringPolicy,
		type TextureFilteringCapabilities,
		type TextureFilteringPolicy,
	} from "../../lib/game/renderer/texture-filtering-policy";

	const CAMERA_FOV_DEGREES = 90;
	const CAMERA_NEAR = 0.5;
	const CAMERA_FAR = 2_000;
	const query = new URLSearchParams(window.location.search);
	/** Sits above the runtime's conservative ±510 outdoor terrain bound. */
	const cameraHeightSource = query.get("cameraHeight");
	const CAMERA_HEIGHT =
		cameraHeightSource === null ? 600 : Number(cameraHeightSource);
	const VIEWPORT_WIDTH = parsePositiveIntegerQuery(
		query,
		"viewportWidth",
		1_280,
	);
	const VIEWPORT_HEIGHT = parsePositiveIntegerQuery(
		query,
		"viewportHeight",
		720,
	);
	const ISOLATE_AUTHORED_DYNAMICS =
		query.get("isolateAuthoredDynamics") === "true";
	const EXCLUDE_AUTHORED_DYNAMICS =
		query.get("excludeAuthoredDynamics") === "true";
	if (!Number.isFinite(CAMERA_HEIGHT)) {
		throw new Error("Browser harness camera height must be finite.");
	}

	interface BrowserHarnessApi {
		/** Request canonical outdoor layers for one neighborhood. */
		readonly requestSceneInterest: (
			landblockId: string,
			buildingRadius: number,
			envCellRadius: number | null,
			explicitObjectRadius: number | null,
			generatedObjectRadius: number | null,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Move only the render-world anchor; current scene interest remains installed. */
		readonly setCameraLandblock: (
			landblockId: string,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Place the continuous camera at one explicit outdoor world-space pose. */
		readonly setOutdoorCamera: (
			landblockId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Apply the Explorer's automatic outdoor focus policy after terrain becomes queryable. */
		readonly focusExplorerOutdoor: (
			landblockId: string,
		) => BrowserHarnessCameraEvidence;
		/** Place the continuous camera at one authoritative EnvCell pose. */
		readonly setEnvCellCamera: (
			envCellId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Change EnvCell rendering policy without changing camera placement or scene interest. */
		readonly setEnvCellRenderMode: (
			envCellRenderMode: "flat" | "portal",
		) => void;
		/** Change filterable texture quality without changing content or resources. */
		readonly setTextureFiltering: (policy: string) => void;
		/** Change the generic portal-footprint cutoff without rebuilding content. */
		readonly setMinimumPortalFootprintPixelArea: (pixelArea: number) => void;
		/** Change shared object-footprint policy without rebuilding content. */
		readonly setMinimumObjectFootprintPixelArea: (pixelArea: number) => void;
		/** Change offscreen visual animation cadence without changing semantic advancement. */
		readonly setOffscreenAnimationSampleIntervalSeconds: (
			intervalSeconds: number,
		) => void;
		/** Reset steady-state frame timing after asynchronous content publication settles. */
		readonly resetTiming: () => void;
		/** Explicitly enable or tear down renderer CPU/GPU profiling. */
		readonly setFrameProfiling: (enabled: boolean) => void;
		/** Withdraw every requested scene layer while retaining the harness runtime. */
		readonly clearSceneInterest: () => void;
		/** Exercise the production authoritative-anchor portal trace without moving the camera. */
		readonly tracePortalSegment: (
			envCellId: string,
			start: readonly [number, number, number],
			endpoint: readonly [number, number, number],
		) => ReturnType<GameRuntime["tracePortalSegment"]>;
		/** Exercise final pure portal planning and the shared selected-scope scene query. */
		readonly probePortalRenderGraph: (
			envCellId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
			safetyWorkItemLimit: number,
		) => PortalRenderGraphProbeResult;
		/** Exercise the production portal graph executor without activating public portal mode. */
		readonly probePortalExecution: (
			envCellId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
			safetyWorkItemLimit: number,
		) => PortalExecutionProbeResult;
		/** Snapshot lifecycle evidence without exposing runtime ownership. */
		readonly state: () => BrowserHarnessState;
	}

	interface BrowserHarnessState {
		/** Last harness-authored camera pose, retained to prove benchmark parity. */
		readonly camera: BrowserHarnessCameraEvidence | null;
		readonly error: string | null;
		readonly frames: number;
		readonly metrics: FrameSelectionMetrics | null;
		/** Latest explicit renderer profile, or null while profiling is disabled. */
		readonly frameProfile: RendererFrameProfile | null;
		readonly authoredDynamics: ReturnType<
			GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
		> | null;
		readonly frameSettings: FrameSettings;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		/** Browser main-thread timing facts accumulated during this harness session. */
		readonly timing: BrowserHarnessTiming;
		readonly staticObjects: StaticObjectRuntimeDiagnostics | null;
		/** Layer-separated static diagnostics prove outdoor-static lifetimes stay distinct. */
		readonly staticObjectLayers: {
			readonly buildings: readonly StaticObjectLayerRuntimeDiagnostics[];
			readonly generated: readonly StaticObjectLayerRuntimeDiagnostics[];
			readonly objects: readonly StaticObjectLayerRuntimeDiagnostics[];
		};
		/** Executable facts for the planned portal scene-domain attachment formats. */
		readonly portalTargetCapabilities: PortalTargetCapabilityProbe | null;
		/** Whole-device invalidation proof from an isolated browser context. */
		readonly portalContextLossPolicy: WebGL2ContextLossPolicyProbe | null;
		/** Pixel-read production-substrate evidence requested by the dedicated fixture. */
		readonly portalSubstrate: WebGL2PortalSubstrateFixtureResult | null;
		/** Pixel-read exterior-transition composition evidence requested by Gate F. */
		readonly hybridPortalExecution: WebGL2HybridPortalExecutionFixtureResult | null;
		/** Pixel-read internal graph execution evidence requested by Gate G. */
		readonly internalPortalExecution: WebGL2InternalPortalExecutionFixtureResult | null;
		/** One read-only observation for every host source-batch response received by this harness. */
		readonly sourceBatches: readonly HttpLandblockSourceBatchDiagnostic[];
		readonly ready: boolean;
		/** CSS and physical viewport dimensions that determine visible work. */
		readonly viewport: BrowserHarnessViewportEvidence;
	}

	interface BrowserHarnessCameraEvidence {
		/** Authoritative indoor residency, or null for an outdoor camera. */
		readonly envCellId: EnvCellId | null;
		readonly far: number;
		readonly fov: number;
		readonly landblockId: LandblockId;
		readonly near: number;
		readonly pitchDegrees: number;
		readonly policy:
			"explicit-env-cell" | "explicit-outdoor" | "explorer-outdoor-focus";
		readonly position: readonly [number, number, number];
		readonly yawDegrees: number;
	}

	interface BrowserHarnessViewportEvidence {
		readonly cssHeight: number;
		readonly cssWidth: number;
		readonly devicePixelRatio: number;
		readonly pixelHeight: number;
		readonly pixelWidth: number;
	}

	interface BrowserHarnessTiming {
		readonly sampleCount: number;
		readonly averageTickMs: number;
		readonly averageRenderMs: number;
		readonly averageFrameWorkMs: number;
		readonly longestTickMs: number;
		readonly longestRenderMs: number;
		readonly longestFrameWorkMs: number;
		/** Largest requestAnimationFrame gap after the harness began drawing. */
		readonly longestFrameGapMs: number;
		/** Long Task API events observed while this harness was mounted. */
		readonly longTaskCount: number;
		/** Largest Long Task API event duration. */
		readonly longestLongTaskMs: number;
	}

	interface BrowserHarnessTimingAccumulator {
		sampleCount: number;
		totalTickMs: number;
		totalRenderMs: number;
		longestTickMs: number;
		longestRenderMs: number;
		longestFrameWorkMs: number;
		longestFrameGapMs: number;
		longTaskCount: number;
		longestLongTaskMs: number;
	}

	interface HarnessGlobal {
		__HOLTBURGER_3D_BROWSER_HARNESS__?: BrowserHarnessApi;
	}

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let error: string | null = $state(null);
	let frames = 0;
	let lastFrameAt: number | undefined;
	let timing: BrowserHarnessTimingAccumulator = $state({
		sampleCount: 0,
		totalTickMs: 0,
		totalRenderMs: 0,
		longestTickMs: 0,
		longestRenderMs: 0,
		longestFrameWorkMs: 0,
		longestFrameGapMs: 0,
		longTaskCount: 0,
		longestLongTaskMs: 0,
	});
	let contentSource: HttpLandblockContentSource | undefined;
	let runtime: GameRuntime | undefined;
	let renderer: WebGL2Renderer | undefined;
	let textureFilteringCapabilities: TextureFilteringCapabilities | null = null;
	let cameraEvidence: BrowserHarnessCameraEvidence | null = null;
	let frameSettings: FrameSettings = {
		...DEFAULT_FRAME_SETTINGS,
		envCellRenderMode: "flat",
	};
	let portalTargetCapabilities: PortalTargetCapabilityProbe | null = null;
	let portalContextLossPolicy: WebGL2ContextLossPolicyProbe | null = null;
	let portalSubstrate: WebGL2PortalSubstrateFixtureResult | null = null;
	let hybridPortalExecution: WebGL2HybridPortalExecutionFixtureResult | null =
		null;
	let internalPortalExecution: WebGL2InternalPortalExecutionFixtureResult | null =
		null;
	let ready = false;
	const fixture = query.get("fixture");

	function parseOutdoorLandblockId(value: string): LandblockId {
		const match = /^(?:0x)?([0-9a-f]{4})(?:[0-9a-f]{4})?$/i.exec(value.trim());
		if (!match) {
			throw new Error(
				"Browser harness landblock id must contain four or eight hexadecimal digits.",
			);
		}
		return `0x${match[1]!.toLowerCase()}ffff`;
	}

	function requestSceneInterest(
		rawLandblockId: string,
		buildingRadius: number,
		envCellRadius: number | null,
		explicitObjectRadius: number | null,
		generatedObjectRadius: number | null,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isInteger(buildingRadius) || buildingRadius < 0) {
			throw new Error(
				"Browser harness building radius must be a non-negative integer.",
			);
		}
		if (
			envCellRadius !== null &&
			(!Number.isInteger(envCellRadius) ||
				envCellRadius < 0 ||
				envCellRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness EnvCell radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			explicitObjectRadius !== null &&
			(!Number.isInteger(explicitObjectRadius) ||
				explicitObjectRadius < 0 ||
				explicitObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness explicit-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			generatedObjectRadius !== null &&
			(!Number.isInteger(generatedObjectRadius) ||
				generatedObjectRadius < 0 ||
				generatedObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness generated-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)) {
			throw new Error("Browser harness camera orientation must be finite.");
		}
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const usesGeneratedFixture = fixture === "instanced";
		runtime.updateSceneInterest({
			anchorLandblockId: landblockId,
			lod: {
				buildingRadius: usesGeneratedFixture ? null : buildingRadius,
				envCellRadius,
				explicitObjectRadius,
				generatedObjectRadius: usesGeneratedFixture
					? buildingRadius
					: generatedObjectRadius,
				terrainRadius: buildingRadius,
			},
		});
		setCameraLandblock(landblockId, cameraYawDegrees, cameraPitchDegrees);
	}

	function setCameraLandblock(
		rawLandblockId: string,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const origin = createLandblockWorldOrigin(landblockId);
		const position = new Vec3(
			origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
			CAMERA_HEIGHT,
			origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		);
		setOutdoorCamera(
			landblockId,
			[position.x, position.y, position.z],
			cameraYawDegrees,
			cameraPitchDegrees,
		);
	}

	function setOutdoorCamera(
		rawLandblockId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness outdoor camera requires a finite position and orientation.",
			);
		}
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const cameraPosition = new Vec3(...position);
		runtime.setPrimaryCamera({
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			near: CAMERA_NEAR,
			placement: {
				envCellId: null,
				landblockId,
				position: cameraPosition,
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
		cameraEvidence = {
			envCellId: null,
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			landblockId,
			near: CAMERA_NEAR,
			pitchDegrees: cameraPitchDegrees,
			policy: "explicit-outdoor",
			position,
			yawDegrees: cameraYawDegrees,
		};
	}

	function focusExplorerOutdoor(
		rawLandblockId: string,
	): BrowserHarnessCameraEvidence {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const pose = resolveExplorerOutdoorFocusPose(runtime, landblockId);
		if (!pose) {
			throw new Error(
				`Browser harness cannot apply Explorer focus before terrain ${landblockId} is queryable.`,
			);
		}
		runtime.setPrimaryCamera({
			...EXPLORER_CAMERA_FRAMING,
			placement: {
				envCellId: null,
				landblockId,
				position: pose.position,
				rotation: createCameraRotationRadians(
					pose.yawRadians,
					pose.pitchRadians,
				),
			},
		});
		cameraEvidence = {
			...EXPLORER_CAMERA_FRAMING,
			envCellId: null,
			landblockId,
			pitchDegrees: (pose.pitchRadians * 180) / Math.PI,
			policy: "explorer-outdoor-focus",
			position: [pose.position.x, pose.position.y, pose.position.z],
			yawDegrees: (pose.yawRadians * 180) / Math.PI,
		};
		return cameraEvidence;
	}

	function setEnvCellCamera(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness portal frame requires a finite position and orientation.",
			);
		}
		const envCellId = parseEnvCellId(rawEnvCellId, "portal frame");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockId;
		runtime.setPrimaryCamera({
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			near: CAMERA_NEAR,
			placement: {
				envCellId,
				landblockId,
				position: new Vec3(...position),
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
		cameraEvidence = {
			envCellId,
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			landblockId,
			near: CAMERA_NEAR,
			pitchDegrees: cameraPitchDegrees,
			policy: "explicit-env-cell",
			position,
			yawDegrees: cameraYawDegrees,
		};
	}

	function setEnvCellRenderMode(envCellRenderMode: "flat" | "portal"): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = { ...frameSettings, envCellRenderMode };
		runtime.setFrameSettings(frameSettings);
	}

	function setTextureFiltering(rawPolicy: string): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!isTextureFilteringPolicy(rawPolicy)) {
			throw new Error(`Unknown texture filtering policy ${rawPolicy}.`);
		}
		const policy: TextureFilteringPolicy = rawPolicy;
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, textureFiltering: policy },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setMinimumPortalFootprintPixelArea(pixelArea: number): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isFinite(pixelArea) || pixelArea < 0) {
			throw new Error(
				"Minimum portal footprint pixel area must be non-negative and finite.",
			);
		}
		frameSettings = {
			...frameSettings,
			quality: {
				...frameSettings.quality,
				minimumPortalFootprintPixelArea: pixelArea,
			},
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setMinimumObjectFootprintPixelArea(pixelArea: number): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isFinite(pixelArea) || pixelArea < 0) {
			throw new Error(
				"Minimum object-footprint pixel area must be non-negative and finite.",
			);
		}
		frameSettings = {
			...frameSettings,
			quality: {
				...frameSettings.quality,
				minimumObjectFootprintPixelArea: pixelArea,
			},
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setOffscreenAnimationSampleIntervalSeconds(
		intervalSeconds: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.setOffscreenAnimationSampleIntervalSeconds(intervalSeconds);
	}

	function setFrameProfiling(enabled: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.setRendererFrameProfilingEnabled(enabled);
	}

	function clearSceneInterest(): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.clearSceneInterest();
	}

	function resetTiming(): void {
		timing = {
			sampleCount: 0,
			totalTickMs: 0,
			totalRenderMs: 0,
			longestTickMs: 0,
			longestRenderMs: 0,
			longestFrameWorkMs: 0,
			longestFrameGapMs: 0,
			longTaskCount: 0,
			longestLongTaskMs: 0,
		};
		lastFrameAt = undefined;
	}

	function timingSnapshot(): BrowserHarnessTiming {
		const divisor = Math.max(1, timing.sampleCount);
		return {
			averageFrameWorkMs: (timing.totalTickMs + timing.totalRenderMs) / divisor,
			averageRenderMs: timing.totalRenderMs / divisor,
			averageTickMs: timing.totalTickMs / divisor,
			longestFrameGapMs: timing.longestFrameGapMs,
			longestFrameWorkMs: timing.longestFrameWorkMs,
			longestLongTaskMs: timing.longestLongTaskMs,
			longestRenderMs: timing.longestRenderMs,
			longestTickMs: timing.longestTickMs,
			longTaskCount: timing.longTaskCount,
			sampleCount: timing.sampleCount,
		};
	}

	function tracePortalSegment(
		rawEnvCellId: string,
		start: readonly [number, number, number],
		endpoint: readonly [number, number, number],
	): ReturnType<GameRuntime["tracePortalSegment"]> {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const envCellId = parseEnvCellId(rawEnvCellId, "trace");
		if (
			start.length !== 3 ||
			endpoint.length !== 3 ||
			![...start, ...endpoint].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness portal trace points must be finite xyz tuples.",
			);
		}
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockId;
		return runtime.tracePortalSegment({
			anchor: {
				position: new Vec3(...start),
				residency: { envCellId, landblockId },
			},
			endpoint: new Vec3(...endpoint),
		});
	}

	function probePortalRenderGraph(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
		safetyWorkItemLimit: number,
	): PortalRenderGraphProbeResult {
		if (!renderer) throw new Error("Browser harness renderer is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite) ||
			!Number.isInteger(safetyWorkItemLimit) ||
			safetyWorkItemLimit <= 0
		) {
			throw new Error(
				"Browser harness portal graph probe requires a finite position/orientation and positive integer work limit.",
			);
		}
		const envCellId = parseEnvCellId(rawEnvCellId, "portal graph");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockId;
		return renderer.probePortalRenderGraph(
			landblockId,
			{
				camera: {
					far: CAMERA_FAR,
					fov: CAMERA_FOV_DEGREES,
					near: CAMERA_NEAR,
					placement: {
						envCellId,
						landblockId,
						position: new Vec3(...position),
						rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
					},
				},
			},
			{ envCellId, kind: "env-cell", landblockId },
			safetyWorkItemLimit,
		);
	}

	function probePortalExecution(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
		safetyWorkItemLimit: number,
	): PortalExecutionProbeResult {
		if (!renderer) throw new Error("Browser harness renderer is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite) ||
			!Number.isInteger(safetyWorkItemLimit) ||
			safetyWorkItemLimit <= 0
		) {
			throw new Error(
				"Browser harness portal execution probe requires a finite position/orientation and positive integer work limit.",
			);
		}
		const envCellId = parseEnvCellId(rawEnvCellId, "portal execution");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockId;
		return renderer.probePortalExecution(
			landblockId,
			{
				camera: {
					far: CAMERA_FAR,
					fov: CAMERA_FOV_DEGREES,
					near: CAMERA_NEAR,
					placement: {
						envCellId,
						landblockId,
						position: new Vec3(...position),
						rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
					},
				},
			},
			{ envCellId, kind: "env-cell", landblockId },
			safetyWorkItemLimit,
		);
	}

	function parseEnvCellId(rawEnvCellId: string, operation: string): EnvCellId {
		const match = /^(?:0x)?([0-9a-f]{8})$/i.exec(rawEnvCellId.trim());
		if (!match) {
			throw new Error(
				`Browser harness ${operation} EnvCell id must contain eight hexadecimal digits.`,
			);
		}
		return `0x${match[1]!.toLowerCase()}`;
	}

	function cameraRotation(yawDegrees: number, pitchDegrees: number) {
		const yaw = (yawDegrees * Math.PI) / 180;
		const pitch = (pitchDegrees * Math.PI) / 180;
		return createCameraRotationRadians(yaw, pitch);
	}

	function parsePositiveIntegerQuery(
		parameters: URLSearchParams,
		name: string,
		fallback: number,
	): number {
		const rawValue = parameters.get(name);
		if (rawValue === null) return fallback;
		const value = Number(rawValue);
		if (!Number.isInteger(value) || value <= 0) {
			throw new Error(`Browser harness ${name} must be a positive integer.`);
		}
		return value;
	}

	onMount(() => {
		if (!canvasElement) {
			error = "Browser harness canvas was not mounted.";
			return;
		}
		const hostUrl = query.get("contentHost");
		if (!hostUrl) {
			error = "Browser harness requires a contentHost query parameter.";
			return;
		}

		let destroyed = false;
		let frameHandle: number | undefined;
		let longTaskObserver: PerformanceObserver | undefined;
		let pipeline:
			| StandardCommitPipeline
			| SyntheticBlendedBuildingPipeline
			| SyntheticInstancedObjectPipeline
			| undefined;
		let device: WebGL2Device | undefined;
		let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
		const hostGlobal = globalThis as typeof globalThis & HarnessGlobal;
		const start = async (): Promise<void> => {
			try {
				contentSource = await HttpLandblockContentSource.build(hostUrl);
				const landblockSource = ISOLATE_AUTHORED_DYNAMICS
					? new DynamicOnlyLandblockSource(contentSource)
					: EXCLUDE_AUTHORED_DYNAMICS
						? new WithoutAuthoredDynamicsLandblockSource(contentSource)
						: contentSource;
				device = await WebGL2Device.build(canvasElement!);
				textureFilteringCapabilities = device.getTextureFilteringCapabilities();
				if (fixture === "portal-substrate") {
					portalTargetCapabilities = device.probePortalTargetCapabilities();
					portalSubstrate = device.probePortalSubstrate();
					portalContextLossPolicy = await WebGL2Device.probeContextLossPolicy();
				}
				if (fixture === "portal-hybrid-execution") {
					hybridPortalExecution = device.probeHybridPortalExecution();
				}
				if (fixture === "portal-internal-execution") {
					internalPortalExecution = device.probeInternalPortalExecution();
				}
				pipeline =
					fixture === "blended"
						? new SyntheticBlendedBuildingPipeline()
						: fixture === "instanced"
							? new SyntheticInstancedObjectPipeline()
							: await StandardCommitPipeline.build({
									sourceBatch: landblockSource,
								});
				runtime = await GameRuntime.build(
					{
						buildRenderer: async (world) => {
							renderer = await device!.buildRenderer(world);
							return renderer;
						},
						resources: device.resources,
					},
					pipeline,
					contentSource,
					contentSource,
				);
				// Harness comparisons select their render policy explicitly and start from flat.
				runtime.setFrameSettings(frameSettings);
				staticDetailOwner = new ActiveRegionStaticDetailOwner(contentSource);
				runtime.installActiveRegionStaticDetails(
					await staticDetailOwner.install(contentSource.activeRegion),
				);
				if (destroyed) return;
				ready = true;
				if ("PerformanceObserver" in window) {
					longTaskObserver = new PerformanceObserver((entries) => {
						for (const entry of entries.getEntries()) {
							timing = {
								...timing,
								longTaskCount: timing.longTaskCount + 1,
								longestLongTaskMs: Math.max(
									timing.longestLongTaskMs,
									entry.duration,
								),
							};
						}
					});
					longTaskObserver.observe({ buffered: true, type: "longtask" });
				}
				hostGlobal.__HOLTBURGER_3D_BROWSER_HARNESS__ = {
					clearSceneInterest,
					focusExplorerOutdoor,
					probePortalExecution,
					probePortalRenderGraph,
					requestSceneInterest,
					setCameraLandblock,
					setEnvCellCamera,
					setEnvCellRenderMode,
					setOutdoorCamera,
					setFrameProfiling,
					setMinimumObjectFootprintPixelArea,
					setMinimumPortalFootprintPixelArea,
					setOffscreenAnimationSampleIntervalSeconds,
					setTextureFiltering,
					resetTiming,
					tracePortalSegment,
					state: () => {
						const staticObjects =
							runtime?.getStaticObjectRuntimeDiagnostics() ?? null;
						const frameDiagnostics =
							runtime?.getRendererFrameDiagnostics() ?? null;
						return {
							authoredDynamics:
								runtime?.getAuthoredDynamicRuntimeDiagnostics() ?? null,
							camera: cameraEvidence,
							error,
							frameSettings,
							frameProfile: frameDiagnostics?.profile ?? null,
							hybridPortalExecution,
							frames,
							internalPortalExecution,
							metrics: frameDiagnostics?.selectionMetrics ?? null,
							portalContextLossPolicy,
							portalSubstrate,
							portalTargetCapabilities,
							ready,
							staticObjectLayers: {
								buildings:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Buildings,
									) ?? [],
								generated:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Generated,
									) ?? [],
								objects:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Objects,
									) ?? [],
							},
							staticObjects,
							sourceBatches:
								contentSource?.getLandblockSourceBatchDiagnostics() ?? [],
							timing: timingSnapshot(),
							textureFilteringCapabilities,
							viewport: {
								cssHeight: canvasElement!.clientHeight,
								cssWidth: canvasElement!.clientWidth,
								devicePixelRatio: window.devicePixelRatio,
								pixelHeight: canvasElement!.height,
								pixelWidth: canvasElement!.width,
							},
						};
					},
				};
				const frame = (): void => {
					if (!runtime || destroyed) return;
					const now = performance.now();
					if (lastFrameAt !== undefined) {
						timing = {
							...timing,
							longestFrameGapMs: Math.max(
								timing.longestFrameGapMs,
								now - lastFrameAt,
							),
						};
					}
					lastFrameAt = now;
					const tickStartedAt = performance.now();
					runtime.tick();
					const renderStartedAt = performance.now();
					runtime.render(renderStartedAt / 1_000);
					const frameFinishedAt = performance.now();
					const tickMs = renderStartedAt - tickStartedAt;
					const renderMs = frameFinishedAt - renderStartedAt;
					timing = {
						...timing,
						longestFrameWorkMs: Math.max(
							timing.longestFrameWorkMs,
							frameFinishedAt - tickStartedAt,
						),
						longestRenderMs: Math.max(timing.longestRenderMs, renderMs),
						longestTickMs: Math.max(timing.longestTickMs, tickMs),
						sampleCount: timing.sampleCount + 1,
						totalRenderMs: timing.totalRenderMs + renderMs,
						totalTickMs: timing.totalTickMs + tickMs,
					};
					frames += 1;
					frameHandle = window.requestAnimationFrame(frame);
				};
				frameHandle = window.requestAnimationFrame(frame);
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		};
		void start();

		return () => {
			destroyed = true;
			if (frameHandle !== undefined) window.cancelAnimationFrame(frameHandle);
			longTaskObserver?.disconnect();
			delete hostGlobal.__HOLTBURGER_3D_BROWSER_HARNESS__;
			staticDetailOwner?.teardown();
			void runtime?.destroy().finally(async () => {
				await pipeline?.destroy();
				await device?.destroy();
			});
		};
	});
</script>

<canvas
	bind:this={canvasElement}
	aria-label="Browser harness render viewport"
	style:height={`${VIEWPORT_HEIGHT}px`}
	style:width={`${VIEWPORT_WIDTH}px`}
></canvas>

<style>
	:global(body) {
		margin: 0;
		overflow: hidden;
	}

	canvas {
		display: block;
	}
</style>
