<script lang="ts">
	import { onMount } from "svelte";
	import { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
	import type { HttpLandblockSourceBatchDiagnostic } from "../../lib/assets/http-landblock-content-source";
	import { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
	import { SyntheticBlendedBuildingPipeline } from "./synthetic-blended-building-pipeline";
	import type { LandblockId } from "../../lib/game/game-types";
	import {
		createLandblockWorldOrigin,
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
	} from "../../lib/game/landblocks";
	import { Quat, Vec3 } from "../../lib/game/math/types";
	import { WebGL2Device } from "../../lib/game/renderer/webgl2-device";
	import {
		GameRuntime,
		type StaticObjectLayerRuntimeDiagnostics,
		type StaticObjectRuntimeDiagnostics,
	} from "../../lib/game/runtime/game-runtime";
	import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
	import { ActiveRegionObjectDetailOwner } from "../../lib/game/resolution/active-region-object-detail";
	import type { FrameSelectionMetrics } from "../../lib/game/renderer/renderer";

	const CAMERA_FOV_DEGREES = 90;
	const CAMERA_NEAR = 0.5;
	const CAMERA_FAR = 2_000;

	interface TerrainHarnessApi {
		/** Request canonical outdoor layers for one neighborhood. */
		readonly requestOutdoorTerrain: (
			landblockId: string,
			buildingRadius: number,
			explicitObjectRadius: number | null,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Move only the render-world anchor; current scene interest remains installed. */
		readonly setCameraLandblock: (
			landblockId: string,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Withdraw every terrain and building layer while retaining the harness runtime. */
		readonly clearSceneInterest: () => void;
		/** Snapshot lifecycle evidence without exposing runtime ownership. */
		readonly state: () => TerrainHarnessState;
	}

	interface TerrainHarnessState {
		readonly error: string | null;
		readonly frames: number;
		readonly metrics: FrameSelectionMetrics | null;
		/** Browser main-thread timing facts accumulated during this harness session. */
		readonly timing: TerrainHarnessTiming;
		readonly staticObjects: StaticObjectRuntimeDiagnostics | null;
		/** Layer-separated static diagnostics prove buildings and explicit objects stay distinct. */
		readonly staticObjectLayers: {
			readonly buildings: readonly StaticObjectLayerRuntimeDiagnostics[];
			readonly objects: readonly StaticObjectLayerRuntimeDiagnostics[];
		};
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
	let ready = false;

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
		explicitObjectRadius: number | null,
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
			explicitObjectRadius !== null &&
			(!Number.isInteger(explicitObjectRadius) ||
				explicitObjectRadius < 0 ||
				explicitObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Terrain harness explicit-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)) {
			throw new Error("Terrain harness camera orientation must be finite.");
		}
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		runtime.updateSceneInterest({
			anchorLandblockId: landblockId,
			lod: {
				buildingRadius,
				envCellRadius: null,
				explicitObjectRadius,
				generatedObjectRadius: null,
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
					100,
					origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
				),
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
	}

	function clearSceneInterest(): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		runtime.clearSceneInterest();
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
			| undefined;
		let device: WebGL2Device | undefined;
		let objectDetailOwner: ActiveRegionObjectDetailOwner | undefined;
		const hostGlobal = globalThis as typeof globalThis & HarnessGlobal;
		const start = async (): Promise<void> => {
			try {
				contentSource = await HttpLandblockContentSource.build(hostUrl);
				device = await WebGL2Device.build(canvasElement!);
				pipeline =
					new URLSearchParams(window.location.search).get("fixture") ===
					"blended"
						? new SyntheticBlendedBuildingPipeline()
						: await StandardCommitPipeline.build({
								sourceBatch: contentSource,
							});
				runtime = await GameRuntime.build(device, pipeline, contentSource);
				objectDetailOwner = new ActiveRegionObjectDetailOwner(contentSource);
				runtime.installActiveRegionObjectDetail(
					await objectDetailOwner.install(contentSource.activeRegion),
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
					requestOutdoorTerrain,
					setCameraLandblock,
					state: () => {
						const staticObjects =
							runtime?.getStaticObjectRuntimeDiagnostics() ?? null;
						return {
							error,
							frames,
							metrics: runtime?.getFrameSelectionMetrics() ?? null,
							ready,
							staticObjectLayers: {
								buildings:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Buildings,
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
			objectDetailOwner?.teardown();
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
