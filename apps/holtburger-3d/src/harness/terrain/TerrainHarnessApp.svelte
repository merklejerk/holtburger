<script lang="ts">
	import { onMount } from "svelte";
	import { HttpTerrainContentSource } from "../../lib/assets/http-terrain-content-source";
	import { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
	import type { LandblockId } from "../../lib/game/game-types";
	import {
		createLandblockWorldOrigin,
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
	} from "../../lib/game/landblocks";
	import { Quat, Vec3 } from "../../lib/game/math/types";
	import { WebGL2Device } from "../../lib/game/renderer/webgl2-device";
	import { GameRuntime } from "../../lib/game/runtime/game-runtime";

	const CAMERA_FOV_DEGREES = 90;
	const CAMERA_NEAR = 0.5;
	const CAMERA_FAR = 2_000;

	interface TerrainHarnessApi {
		/** Request an outdoor terrain layer and position the camera above its center. */
		readonly requestOutdoorTerrain: (landblockId: string) => void;
		/** Snapshot lifecycle evidence without exposing runtime ownership. */
		readonly state: () => TerrainHarnessState;
	}

	interface TerrainHarnessState {
		readonly error: string | null;
		readonly frames: number;
		readonly ready: boolean;
	}

	interface HarnessGlobal {
		__HOLTBURGER_3D_TERRAIN_HARNESS__?: TerrainHarnessApi;
	}

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let error: string | null = $state(null);
	let frames = 0;
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

	function requestOutdoorTerrain(rawLandblockId: string): void {
		if (!runtime) throw new Error("Terrain harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		runtime.updateSceneInterest({
			anchorLandblockId: landblockId,
			lod: {
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 0,
			},
		});
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
				rotation: cameraRotation(0, -45),
			},
		});
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
		let pipeline: StandardCommitPipeline | undefined;
		let device: WebGL2Device | undefined;
		const hostGlobal = globalThis as typeof globalThis & HarnessGlobal;
		const start = async (): Promise<void> => {
			try {
				const source = await HttpTerrainContentSource.build(hostUrl);
				device = await WebGL2Device.build(canvasElement!);
				pipeline = await StandardCommitPipeline.build(source);
				runtime = await GameRuntime.build(device, pipeline, source);
				if (destroyed) return;
				ready = true;
				hostGlobal.__HOLTBURGER_3D_TERRAIN_HARNESS__ = {
					requestOutdoorTerrain,
					state: () => ({ error, frames, ready }),
				};
				const frame = (): void => {
					if (!runtime || destroyed) return;
					runtime.frame(performance.now() / 1_000);
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
			delete hostGlobal.__HOLTBURGER_3D_TERRAIN_HARNESS__;
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
