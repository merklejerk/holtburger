<script lang="ts">
	import { onMount } from "svelte";
	import { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
	import type { HttpLandblockSourceBatchDiagnostic } from "../../lib/assets/http-landblock-content-source";
	import { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
	import { SyntheticBlendedBuildingPipeline } from "./synthetic-blended-building-pipeline";
	import { SyntheticInstancedObjectPipeline } from "./synthetic-instanced-object-pipeline";
	import type { EnvCellId, LandblockId } from "../../lib/game/game-types";
	import {
		createLandblockWorldOrigin,
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
	} from "../../lib/game/landblocks";
	import { Quat, Vec3 } from "../../lib/game/math/types";
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
	/** Sits above the runtime's conservative ±510 outdoor terrain bound. */
	const CAMERA_HEIGHT = 600;

	interface TerrainHarnessApi {
		/** Request canonical outdoor layers for one neighborhood. */
		readonly requestOutdoorTerrain: (
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
		/** Withdraw every terrain and outdoor-static layer while retaining the harness runtime. */
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
		readonly state: () => TerrainHarnessState;
	}

	interface TerrainHarnessState {
		readonly error: string | null;
		readonly frames: number;
		readonly metrics: FrameSelectionMetrics | null;
		readonly frameSettings: FrameSettings;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		/** Browser main-thread timing facts accumulated during this harness session. */
		readonly timing: TerrainHarnessTiming;
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
	}

	interface TerrainHarnessTiming {
		/** Largest requestAnimationFrame gap after the harness began drawing. */
		readonly longestFrameGapMs: number;
		/** Long Task API events observed while this harness was mounted. */
		readonly longTaskCount: number;
		/** Largest Long Task API event duration. */
		readonly longestLongTaskMs: number;
	}

	interface HarnessGlobal {
		__HOLTBURGER_3D_TERRAIN_HARNESS__?: TerrainHarnessApi;
	}

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let error: string | null = $state(null);
	let frames = 0;
	let timing: TerrainHarnessTiming = $state({
		longestFrameGapMs: 0,
		longTaskCount: 0,
		longestLongTaskMs: 0,
	});
	let contentSource: HttpLandblockContentSource | undefined;
	let runtime: GameRuntime | undefined;
	let renderer: WebGL2Renderer | undefined;
	let textureFilteringCapabilities: TextureFilteringCapabilities | null = null;
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
	const fixture = new URLSearchParams(window.location.search).get("fixture");

	function parseOutdoorLandblockId(value: string): LandblockId {
		const match = /^(?:0x)?([0-9a-f]{4})(?:[0-9a-f]{4})?$/i.exec(value.trim());
		if (!match) {
			throw new Error(
				"Terrain harness landblock id must contain four or eight hexadecimal digits.",
			);
		}
		return `0x${match[1]!.toLowerCase()}ffff`;
	}

	function requestOutdoorTerrain(
		rawLandblockId: string,
		buildingRadius: number,
		envCellRadius: number | null,
		explicitObjectRadius: number | null,
		generatedObjectRadius: number | null,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		if (!Number.isInteger(buildingRadius) || buildingRadius < 0) {
			throw new Error(
				"Terrain harness building radius must be a non-negative integer.",
			);
		}
		if (
			envCellRadius !== null &&
			(!Number.isInteger(envCellRadius) ||
				envCellRadius < 0 ||
				envCellRadius > buildingRadius)
		) {
			throw new Error(
				"Terrain harness EnvCell radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			explicitObjectRadius !== null &&
			(!Number.isInteger(explicitObjectRadius) ||
				explicitObjectRadius < 0 ||
				explicitObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Terrain harness explicit-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			generatedObjectRadius !== null &&
			(!Number.isInteger(generatedObjectRadius) ||
				generatedObjectRadius < 0 ||
				generatedObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Terrain harness generated-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)) {
			throw new Error("Terrain harness camera orientation must be finite.");
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
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const origin = createLandblockWorldOrigin(landblockId);
		runtime.setPrimaryCamera({
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			near: CAMERA_NEAR,
			placement: {
				envCellId: null,
				landblockId,
				position: new Vec3(
					origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
					CAMERA_HEIGHT,
					origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
				),
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
	}

	function setEnvCellCamera(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Terrain harness portal frame requires a finite position and orientation.",
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
	}

	function setEnvCellRenderMode(envCellRenderMode: "flat" | "portal"): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		frameSettings = { ...frameSettings, envCellRenderMode };
		runtime.setFrameSettings(frameSettings);
	}

	function setTextureFiltering(rawPolicy: string): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
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

	function clearSceneInterest(): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		runtime.clearSceneInterest();
	}

	function tracePortalSegment(
		rawEnvCellId: string,
		start: readonly [number, number, number],
		endpoint: readonly [number, number, number],
	): ReturnType<GameRuntime["tracePortalSegment"]> {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		const envCellId = parseEnvCellId(rawEnvCellId, "trace");
		if (
			start.length !== 3 ||
			endpoint.length !== 3 ||
			![...start, ...endpoint].every(Number.isFinite)
		) {
			throw new Error(
				"Terrain harness portal trace points must be finite xyz tuples.",
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
		if (!renderer) throw new Error("Terrain harness renderer is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite) ||
			!Number.isInteger(safetyWorkItemLimit) ||
			safetyWorkItemLimit <= 0
		) {
			throw new Error(
				"Terrain harness portal graph probe requires a finite position/orientation and positive integer work limit.",
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
		if (!renderer) throw new Error("Terrain harness renderer is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite) ||
			!Number.isInteger(safetyWorkItemLimit) ||
			safetyWorkItemLimit <= 0
		) {
			throw new Error(
				"Terrain harness portal execution probe requires a finite position/orientation and positive integer work limit.",
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
				`Terrain harness ${operation} EnvCell id must contain eight hexadecimal digits.`,
			);
		}
		return `0x${match[1]!.toLowerCase()}`;
	}

	function cameraRotation(yawDegrees: number, pitchDegrees: number): Quat {
		const yaw = (yawDegrees * Math.PI) / 180;
		const pitch = (pitchDegrees * Math.PI) / 180;
		const halfYaw = yaw / 2;
		const halfPitch = pitch / 2;
		return new Quat(
			Math.cos(halfYaw) * Math.cos(halfPitch),
			Math.cos(halfYaw) * Math.sin(halfPitch),
			Math.sin(halfYaw) * Math.cos(halfPitch),
			-Math.sin(halfYaw) * Math.sin(halfPitch),
		);
	}

	onMount(() => {
		if (!canvasElement) {
			error = "Terrain harness canvas was not mounted.";
			return;
		}
		const hostUrl = new URLSearchParams(window.location.search).get(
			"contentHost",
		);
		if (!hostUrl) {
			error = "Terrain harness requires a contentHost query parameter.";
			return;
		}

		let destroyed = false;
		let frameHandle: number | undefined;
		let lastFrameAt: number | undefined;
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
									sourceBatch: contentSource,
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
				hostGlobal.__HOLTBURGER_3D_TERRAIN_HARNESS__ = {
					clearSceneInterest,
					probePortalExecution,
					probePortalRenderGraph,
					requestOutdoorTerrain,
					setCameraLandblock,
					setEnvCellCamera,
					setEnvCellRenderMode,
					setTextureFiltering,
					tracePortalSegment,
					state: () => {
						const staticObjects =
							runtime?.getStaticObjectRuntimeDiagnostics() ?? null;
						return {
							error,
							frameSettings,
							hybridPortalExecution,
							frames,
							internalPortalExecution,
							metrics: runtime?.getFrameSelectionMetrics() ?? null,
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
							timing: {
								longestFrameGapMs: timing.longestFrameGapMs,
								longTaskCount: timing.longTaskCount,
								longestLongTaskMs: timing.longestLongTaskMs,
							},
							textureFilteringCapabilities,
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
					runtime.frame(now / 1_000);
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
			delete hostGlobal.__HOLTBURGER_3D_TERRAIN_HARNESS__;
			staticDetailOwner?.teardown();
			void runtime?.destroy().finally(async () => {
				await pipeline?.destroy();
				await device?.destroy();
			});
		};
	});
</script>

<canvas bind:this={canvasElement} aria-label="Terrain harness render viewport"
></canvas>

<style>
	:global(body) {
		margin: 0;
		overflow: hidden;
	}

	canvas {
		display: block;
		height: 720px;
		width: 1280px;
	}
</style>
