<script lang="ts">
	import { onMount } from "svelte";
	import { createBrowserRuntime } from "../lib/browser/create-browser-runtime";
	import {
		DEFAULT_BUILDING_LOD_RADIUS,
		DEFAULT_ENV_CELL_LOD_RADIUS,
		DEFAULT_EXPLICIT_OBJECT_LOD_RADIUS,
		DEFAULT_GENERATED_SCENERY_LOD_RADIUS,
		DEFAULT_TERRAIN_LOD_RADIUS,
	} from "../lib/browser/outdoor-scene-interest";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		RuntimeOverviewSnapshot,
	} from "../lib/runtime/client-runtime";
	import type { RuntimeDiagnosticsReport } from "../lib/runtime/diagnostics";
	import {
		createFreeCameraFrameStateCamera,
		createFreeCameraState,
	} from "../lib/camera/free-camera";

	const HARNESS_DEFAULT_DOMAINS: readonly ManualStaticDomain[] = [
		"buildings",
		"env-cells",
		"explicit-objects",
		"generated-scenery",
		"terrain",
	];
	const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
	const DEFAULT_WAIT_POLL_MS = 250;

	type BrowserPipelineHarnessApi = {
		readonly clearSceneInterest: () => RuntimeOverviewSnapshot;
		readonly createDiagnosticsReport: () => RuntimeDiagnosticsReport;
		readonly createOverviewSnapshot: () => RuntimeOverviewSnapshot;
		readonly requestOutdoorScene: (
			options: BrowserPipelineHarnessOutdoorSceneOptions,
		) => Promise<RuntimeOverviewSnapshot>;
		readonly waitForStatus: (
			status: RuntimeOverviewSnapshot["status"],
			options?: BrowserPipelineHarnessWaitOptions,
		) => Promise<RuntimeOverviewSnapshot>;
	};

	type BrowserPipelineHarnessOutdoorSceneOptions = {
		readonly landblockId: number | string;
		readonly domains?: readonly ManualStaticDomain[];
		readonly lod?: {
			readonly buildings?: number;
			readonly detail?: number;
			readonly terrain?: number;
			readonly envCells?: number;
		};
		readonly timeoutMs?: number;
	};

	type BrowserPipelineHarnessWaitOptions = {
		readonly pollMs?: number;
		readonly timeoutMs?: number;
	};

	type HarnessWindow = Window &
		typeof globalThis & {
			__HOLTBURGER_3D_HARNESS__?: BrowserPipelineHarnessApi;
		};

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let runtime: ClientRuntime | null = null;
	let runtimeFrameId: number | null = null;
	let statusText = $state("starting");

	onMount(() => {
		if (!canvasElement) {
			statusText = "missing canvas";
			return;
		}

		try {
			runtime = createBrowserRuntime(canvasElement);
			runtime.updateCameraState(
				createFreeCameraFrameStateCamera(createFreeCameraState()),
			);
			startRuntimeFrameLoop();
			installHarnessApi();
			statusText = "ready";
		} catch (error) {
			statusText = error instanceof Error ? error.message : String(error);
		}

		return () => {
			stopRuntimeFrameLoop();
			delete harnessWindow().__HOLTBURGER_3D_HARNESS__;
			runtime?.dispose();
			runtime = null;
		};
	});

	function installHarnessApi(): void {
		harnessWindow().__HOLTBURGER_3D_HARNESS__ = {
			clearSceneInterest() {
				const currentRuntime = requireRuntime();
				currentRuntime.updateSceneInterest({ kind: "none" });
				return currentRuntime.createOverviewSnapshot();
			},
			createDiagnosticsReport() {
				return requireRuntime().createDiagnosticsReport();
			},
			createOverviewSnapshot() {
				return requireRuntime().createOverviewSnapshot();
			},
			async requestOutdoorScene(options) {
				const currentRuntime = requireRuntime();
				const lod = options.lod ?? {};
				currentRuntime.updateSceneInterest({
					anchorLandblockId: parseLandblockId(options.landblockId),
					domains: options.domains ?? HARNESS_DEFAULT_DOMAINS,
					kind: "outdoor-anchor",
					lod: {
						buildings: lod.buildings ?? DEFAULT_BUILDING_LOD_RADIUS,
						detail:
							lod.detail ??
							Math.max(
								DEFAULT_EXPLICIT_OBJECT_LOD_RADIUS,
								DEFAULT_GENERATED_SCENERY_LOD_RADIUS,
							),
						envCells: lod.envCells ?? DEFAULT_ENV_CELL_LOD_RADIUS,
						terrain: lod.terrain ?? DEFAULT_TERRAIN_LOD_RADIUS,
					},
					source: "manual",
				});
				return waitForStaticSceneReady({
					timeoutMs: options.timeoutMs,
				});
			},
			waitForStatus(status, options) {
				return waitForRuntimeStatus(status, options);
			},
		};
	}

	function requireRuntime(): ClientRuntime {
		if (!runtime) {
			throw new Error("Holtburger 3D harness runtime is not available.");
		}
		return runtime;
	}

	function harnessWindow(): HarnessWindow {
		return window as HarnessWindow;
	}

	function parseLandblockId(value: number | string): number {
		if (typeof value === "number") {
			if (!Number.isInteger(value)) {
				throw new Error(`Harness landblock id must be an integer: ${value}.`);
			}
			return value;
		}

		const trimmed = value.trim();
		const parsed = Number.parseInt(
			trimmed.startsWith("0x") || trimmed.startsWith("0X")
				? trimmed.slice(2)
				: trimmed,
			16,
		);
		if (!Number.isInteger(parsed)) {
			throw new Error(`Harness landblock id is invalid: ${value}.`);
		}
		return parsed;
	}

	function waitForRuntimeStatus(
		status: RuntimeOverviewSnapshot["status"],
		options: BrowserPipelineHarnessWaitOptions = {},
	): Promise<RuntimeOverviewSnapshot> {
		const pollMs = options.pollMs ?? DEFAULT_WAIT_POLL_MS;
		const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		const startedAt = performance.now();

		return new Promise((resolve, reject) => {
			const poll = () => {
				try {
					const overview = requireRuntime().createOverviewSnapshot();
					statusText = createStatusText(overview);
					if (overview.status === status) {
						resolve(overview);
						return;
					}
					if (performance.now() - startedAt >= timeoutMs) {
						reject(
							new Error(
								`Timed out waiting for runtime status ${status}; current status is ${overview.status}.`,
							),
						);
						return;
					}
					window.setTimeout(poll, pollMs);
				} catch (error) {
					reject(error);
				}
			};
			poll();
		});
	}

	function waitForStaticSceneReady(
		options: BrowserPipelineHarnessWaitOptions = {},
	): Promise<RuntimeOverviewSnapshot> {
		const pollMs = options.pollMs ?? DEFAULT_WAIT_POLL_MS;
		const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		const startedAt = performance.now();

		return new Promise((resolve, reject) => {
			const poll = () => {
				try {
					const overview = requireRuntime().createOverviewSnapshot();
					const diagnostics = requireRuntime().createDiagnosticsReport();
					statusText = createStatusText(overview);
					if (staticSceneIsReady(overview, diagnostics)) {
						resolve(overview);
						return;
					}
					if (performance.now() - startedAt >= timeoutMs) {
						reject(
							new Error(
								`Timed out waiting for static scene readiness: ${createStatusText(overview, diagnostics)}.`,
							),
						);
						return;
					}
					window.setTimeout(poll, pollMs);
				} catch (error) {
					reject(error);
				}
			};
			poll();
		});
	}

	function staticSceneIsReady(
		overview: RuntimeOverviewSnapshot,
		diagnostics: RuntimeDiagnosticsReport,
	): boolean {
		const staticOverview = overview.static;
		const runtimeOverview = diagnostics.runtime;
		return (
			staticOverview.requested > 0 &&
			staticOverview.resolving === 0 &&
			staticOverview.baking === 0 &&
			staticOverview.committed === staticOverview.requested &&
			runtimeOverview.pendingStaticCommitInstallCount === 0 &&
			runtimeOverview.installedStaticDrawUnits ===
				runtimeOverview.sourceStaticDrawUnits
		);
	}

	function createStatusText(
		overview: RuntimeOverviewSnapshot,
		diagnostics?: RuntimeDiagnosticsReport,
	): string {
		const staticOverview = overview.static;
		const installText = diagnostics
			? ` installPending=${diagnostics.runtime.pendingStaticCommitInstallCount} installed=${diagnostics.runtime.installedStaticDrawUnits}/${diagnostics.runtime.sourceStaticDrawUnits}`
			: "";
		return `${overview.status} static ${staticOverview.committed}/${staticOverview.requested} resolving=${staticOverview.resolving} baking=${staticOverview.baking}${installText}`;
	}

	function startRuntimeFrameLoop(): void {
		if (runtimeFrameId !== null) {
			return;
		}

		const tick = (timestampMilliseconds: number) => {
			runtimeFrameId = window.requestAnimationFrame(tick);
			runtime?.tickFrame(timestampMilliseconds / 1000);
		};
		runtimeFrameId = window.requestAnimationFrame(tick);
	}

	function stopRuntimeFrameLoop(): void {
		if (runtimeFrameId === null) {
			return;
		}
		window.cancelAnimationFrame(runtimeFrameId);
		runtimeFrameId = null;
	}
</script>

<svelte:head>
	<title>Holtburger 3D Browser Pipeline Harness</title>
</svelte:head>

<main class="harness-shell">
	<canvas bind:this={canvasElement} aria-label="Browser pipeline harness canvas"
	></canvas>
	<div class="status">{statusText}</div>
</main>

<style>
	.harness-shell {
		background: #05080d;
		color: #d5fff0;
		height: 100vh;
		margin: 0;
		overflow: hidden;
		position: relative;
		width: 100vw;
	}

	canvas {
		display: block;
		height: 100%;
		width: 100%;
	}

	.status {
		background: rgb(0 0 0 / 0.7);
		border: 1px solid rgb(213 255 240 / 0.35);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
			"Liberation Mono", "Courier New", monospace;
		font-size: 12px;
		left: 12px;
		padding: 6px 8px;
		position: absolute;
		top: 12px;
	}
</style>
