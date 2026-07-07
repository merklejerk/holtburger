<script lang="ts">
	import { onMount } from "svelte";
	import { createBrowserRuntime } from "../lib/browser/create-browser-runtime";
	import {
		parseBrowserRuntimePipelineMode,
		type BrowserRuntimePipelineMode,
	} from "../lib/systems/open-world-streaming";
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
	import type { RendererFrameTelemetry } from "../lib/renderer/types";
	import type { StaticSceneSelectionKey } from "../lib/runtime/scene-query/contracts";
	import type { RuntimeDiagnosticsReport } from "../lib/runtime/diagnostics";
	import type { OpenWorldStreamingDiagnosticsSnapshot } from "../lib/systems/open-world-streaming/diagnostics/contracts";
	import type { OpenWorldStreamingStaticPublicationMode } from "../lib/systems/open-world-streaming/composition/open-world-streaming-controller";
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
		readonly createDiagnosticsReport: () => BrowserPipelineHarnessDiagnosticsReport;
		readonly createOverviewSnapshot: () => RuntimeOverviewSnapshot;
		readonly createStaticSelectionDiagnosticsReport: (
			selectionKey: StaticSceneSelectionKey,
		) => ReturnType<ClientRuntime["createStaticSelectionDiagnosticsReport"]>;
		readonly requestOutdoorScene: (
			options: BrowserPipelineHarnessOutdoorSceneOptions,
		) => Promise<RuntimeOverviewSnapshot>;
		readonly requestInteriorCell: (
			options: BrowserPipelineHarnessInteriorCellOptions,
		) => Promise<RuntimeOverviewSnapshot>;
		readonly waitForStatus: (
			status: RuntimeOverviewSnapshot["status"],
			options?: BrowserPipelineHarnessWaitOptions,
		) => Promise<RuntimeOverviewSnapshot>;
		readonly waitForStaticSceneReady: (
			options?: BrowserPipelineHarnessWaitOptions,
		) => Promise<RuntimeOverviewSnapshot>;
	};

	type BrowserPipelineHarnessOutdoorSceneOptions = {
		readonly landblockId: number | string;
		readonly domains?: readonly ManualStaticDomain[];
		readonly lod?: {
			readonly buildings?: number;
			readonly explicitObjects?: number;
			readonly generatedScenery?: number;
			readonly terrain?: number;
			readonly envCells?: number;
		};
		readonly timeoutMs?: number;
	};

	type BrowserPipelineHarnessInteriorCellOptions = {
		readonly envCellId: number | string;
		readonly landblockId: number | string;
		readonly timeoutMs?: number;
	};

	type BrowserPipelineHarnessWaitOptions = {
		readonly pollMs?: number;
		readonly timeoutMs?: number;
	};

	type BrowserPipelineHarnessDiagnosticsReport = RuntimeDiagnosticsReport & {
		/** Harness-only page-thread frame and long-task measurements. */
		readonly harnessFrameDiagnostics: HarnessFrameDiagnostics;
		/** Runtime pipeline selected by the harness URL. */
		readonly runtimePipeline: BrowserRuntimePipelineMode;
		/** Static renderer publication policy selected by the harness URL. */
		readonly staticPublicationMode: OpenWorldStreamingStaticPublicationMode;
	};

	type HarnessFrameDiagnostics = {
		/** Monotonic browser timestamp when harness frame collection began. */
		readonly startedAtMs: number;
		/** Elapsed browser time covered by this diagnostic snapshot. */
		readonly elapsedMs: number;
		/** Harness-observed lifecycle timing for the latest static scene request. */
		readonly staticReadiness: StaticReadinessTimeline;
		/** Main-thread requestAnimationFrame loop that drives ClientRuntime.tickFrame. */
		readonly runtimeTick: HarnessLoopDiagnostics;
		/** Renderer-owned requestAnimationFrame telemetry emitted by the WebGL renderer. */
		readonly rendererFrame: HarnessRendererFrameDiagnostics;
		/** Browser PerformanceObserver longtask entries, when supported by Chrome. */
		readonly longTasks: HarnessLongTaskDiagnostics;
	};

	type HarnessLoopDiagnostics = {
		readonly count: number;
		readonly maxDeltaMs: number;
		readonly maxHandlerMs: number;
		readonly totalHandlerMs: number;
		readonly over16Ms: number;
		readonly over33Ms: number;
		readonly over50Ms: number;
		readonly over100Ms: number;
		readonly recentSlowEvents: readonly HarnessSlowEvent[];
	};

	type HarnessRendererFrameDiagnostics = HarnessLoopDiagnostics & {
		readonly maxRendererHandlerMs: number;
		readonly totalRendererHandlerMs: number;
	};

	type HarnessLongTaskDiagnostics = {
		readonly count: number;
		readonly maxDurationMs: number;
		readonly totalDurationMs: number;
		readonly attribution: HarnessLongTaskAttributionDiagnostics;
		readonly recentEntries: readonly HarnessSlowEvent[];
		readonly supported: boolean;
	};

	type HarnessLongTaskAttributionDiagnostics = {
		readonly beforeStaticRequest: HarnessLongTaskBucketDiagnostics;
		readonly beforeStaticReady: HarnessLongTaskBucketDiagnostics;
		readonly crossingStaticReady: HarnessLongTaskBucketDiagnostics;
		readonly afterStaticReady: HarnessLongTaskBucketDiagnostics;
	};

	type HarnessLongTaskBucketDiagnostics = {
		count: number;
		maxDurationMs: number;
		totalDurationMs: number;
	};

	type HarnessSlowEvent = {
		readonly atMs: number;
		readonly durationMs: number;
		readonly kind: string;
	};

	type HarnessWindow = Window &
		typeof globalThis & {
			__HOLTBURGER_3D_HARNESS__?: BrowserPipelineHarnessApi;
		};

	type StaticReadinessTimeline = {
		lastReadyAtMs: number | null;
		lastRequestDurationMs: number | null;
		lastRequestStartedAtMs: number | null;
	};

	const RECENT_SLOW_EVENT_LIMIT = 40;

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let runtime: ClientRuntime | null = null;
	let runtimeFrameId: number | null = null;
	let unsubscribeRuntimeFrameTelemetry: (() => void) | null = null;
	let longTaskObserver: PerformanceObserver | null = null;
	let statusText = $state("starting");
	let runtimePipeline: BrowserRuntimePipelineMode = "open-world-streaming";
	let staticPublicationMode: OpenWorldStreamingStaticPublicationMode =
		"defer-dense-renderer-until-ready";
	const frameDiagnostics = createMutableHarnessFrameDiagnostics();
	const staticReadinessTimeline: StaticReadinessTimeline = {
		lastReadyAtMs: null,
		lastRequestDurationMs: null,
		lastRequestStartedAtMs: null,
	};

	onMount(() => {
		if (!canvasElement) {
			statusText = "missing canvas";
			return;
		}

		try {
			runtimePipeline = parseBrowserRuntimePipelineMode(
				new URLSearchParams(window.location.search).get("runtime-pipeline"),
			);
			staticPublicationMode = parseStaticPublicationMode(
				new URLSearchParams(window.location.search).get("static-publication"),
			);
			runtime = createBrowserRuntime(canvasElement, {
				runtimePipeline,
				staticPublicationMode,
			});
			runtime.updateCameraState(
				createFreeCameraFrameStateCamera(createFreeCameraState()),
			);
			unsubscribeRuntimeFrameTelemetry = runtime.subscribeFrameTelemetry(
				recordRendererFrameTelemetry,
			);
			startLongTaskObserver();
			startRuntimeFrameLoop();
			installHarnessApi();
			statusText = "ready";
		} catch (error) {
			statusText = error instanceof Error ? error.message : String(error);
		}

		return () => {
			stopRuntimeFrameLoop();
			stopLongTaskObserver();
			unsubscribeRuntimeFrameTelemetry?.();
			unsubscribeRuntimeFrameTelemetry = null;
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
				return createHarnessDiagnosticsReport();
			},
			createOverviewSnapshot() {
				return requireRuntime().createOverviewSnapshot();
			},
			createStaticSelectionDiagnosticsReport(selectionKey) {
				return requireRuntime().createStaticSelectionDiagnosticsReport(
					selectionKey,
				);
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
						explicitObjects:
							lod.explicitObjects ?? DEFAULT_EXPLICIT_OBJECT_LOD_RADIUS,
						generatedScenery:
							lod.generatedScenery ?? DEFAULT_GENERATED_SCENERY_LOD_RADIUS,
						envCells: lod.envCells ?? DEFAULT_ENV_CELL_LOD_RADIUS,
						terrain: lod.terrain ?? DEFAULT_TERRAIN_LOD_RADIUS,
					},
					source: "manual",
				});
				return waitForStaticSceneReady({
					timeoutMs: options.timeoutMs,
				});
			},
			async requestInteriorCell(options) {
				const currentRuntime = requireRuntime();
				currentRuntime.updateSceneInterest({
					envCellId: parseUnsignedHexId(options.envCellId, "env cell"),
					kind: "interior-cell",
					landblockId: parseLandblockId(options.landblockId),
					source: "manual",
				});
				return waitForStaticSceneReady({
					timeoutMs: options.timeoutMs,
				});
			},
			waitForStatus(status, options) {
				return waitForRuntimeStatus(status, options);
			},
			waitForStaticSceneReady(options) {
				return waitForStaticSceneReady(options);
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
		return parseUnsignedHexId(value, "landblock");
	}

	function parseStaticPublicationMode(
		value: string | null,
	): OpenWorldStreamingStaticPublicationMode {
		if (value === null || value.length === 0) {
			return "defer-dense-renderer-until-ready";
		}
		if (
			value === "normal" ||
			value === "suppress-dense-renderer" ||
			value === "defer-dense-renderer-until-ready"
		) {
			return value;
		}
		throw new Error(
			`Unsupported static publication mode "${value}". Expected normal, suppress-dense-renderer, or defer-dense-renderer-until-ready.`,
		);
	}

	function parseUnsignedHexId(value: number | string, label: string): number {
		if (typeof value === "number") {
			if (!Number.isInteger(value)) {
				throw new Error(`Harness ${label} id must be an integer: ${value}.`);
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
			throw new Error(`Harness ${label} id is invalid: ${value}.`);
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
		recordStaticSceneRequestStarted(startedAt);

		return new Promise((resolve, reject) => {
			const poll = () => {
				try {
					const overview = requireRuntime().createOverviewSnapshot();
					const diagnostics = requireRuntime().createDiagnosticsReport();
					statusText = createStatusText(overview);
					if (staticSceneIsReady(overview, diagnostics)) {
						recordStaticSceneReady(performance.now());
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

	function recordStaticSceneRequestStarted(atMs: number): void {
		staticReadinessTimeline.lastRequestStartedAtMs = atMs;
		staticReadinessTimeline.lastReadyAtMs = null;
		staticReadinessTimeline.lastRequestDurationMs = null;
	}

	function recordStaticSceneReady(atMs: number): void {
		staticReadinessTimeline.lastReadyAtMs = atMs;
		staticReadinessTimeline.lastRequestDurationMs =
			staticReadinessTimeline.lastRequestStartedAtMs === null
				? null
				: atMs - staticReadinessTimeline.lastRequestStartedAtMs;
	}

	function staticSceneIsReady(
		overview: RuntimeOverviewSnapshot,
		diagnostics: RuntimeDiagnosticsReport,
	): boolean {
		if (runtimePipeline === "open-world-streaming") {
			const openWorld = findOpenWorldDiagnostics(diagnostics);
			return (
				openWorld !== null &&
				openWorld.artifacts.inFlight === 0 &&
				openWorld.sceneCommits.pending === 0 &&
				openWorld.staticTasks.summary.requested > 0 &&
				openWorld.staticTasks.summary.completed >=
					openWorld.staticTasks.summary.requested &&
				openWorld.staticTasks.summary.failed === 0
			);
		}
		const staticOverview = overview.static;
		const runtimeOverview = diagnostics.runtime;
		return (
			staticOverview.requested > 0 &&
			staticOverview.resolving === 0 &&
			staticOverview.baking === 0 &&
			// `committed` is lifetime commits; `requested` is active tasks.
			staticOverview.committed >= staticOverview.requested &&
			runtimeOverview.pendingStaticCommitInstallCount === 0 &&
			runtimeOverview.installedStaticDrawUnits ===
				runtimeOverview.sourceStaticDrawUnits
		);
	}

	function createStatusText(
		overview: RuntimeOverviewSnapshot,
		diagnostics?: RuntimeDiagnosticsReport,
	): string {
		const openWorld = diagnostics
			? findOpenWorldDiagnostics(diagnostics)
			: null;
		if (runtimePipeline === "open-world-streaming" && openWorld) {
			return `${overview.status} openWorld static ${openWorld.staticTasks.summary.completed}/${openWorld.staticTasks.summary.requested} inFlight=${openWorld.artifacts.inFlight} commitsPending=${openWorld.sceneCommits.pending} runtimeEntities=${openWorld.runtimeEntities.active}`;
		}
		const staticOverview = overview.static;
		const installText = diagnostics
			? ` installPending=${diagnostics.runtime.pendingStaticCommitInstallCount} installed=${diagnostics.runtime.installedStaticDrawUnits}/${diagnostics.runtime.sourceStaticDrawUnits}`
			: "";
		return `${overview.status} static ${staticOverview.committed}/${staticOverview.requested} resolving=${staticOverview.resolving} baking=${staticOverview.baking}${installText}`;
	}

	function findOpenWorldDiagnostics(
		diagnostics: RuntimeDiagnosticsReport,
	): OpenWorldStreamingDiagnosticsSnapshot | null {
		const domain = diagnostics.domains.find(
			(candidate) => candidate.kind === "open-world-streaming",
		);
		return (domain?.summary ??
			null) as OpenWorldStreamingDiagnosticsSnapshot | null;
	}

	function startRuntimeFrameLoop(): void {
		if (runtimeFrameId !== null) {
			return;
		}

		const tick = (timestampMilliseconds: number) => {
			const startedAt = performance.now();
			recordRuntimeTickStart(startedAt);
			runtimeFrameId = window.requestAnimationFrame(tick);
			runtime?.tickFrame(timestampMilliseconds / 1000);
			recordRuntimeTickEnd(startedAt, performance.now());
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

	function createHarnessDiagnosticsReport(): BrowserPipelineHarnessDiagnosticsReport {
		return {
			...requireRuntime().createDiagnosticsReport(),
			harnessFrameDiagnostics: createHarnessFrameDiagnosticsSnapshot(),
			runtimePipeline,
			staticPublicationMode,
		};
	}

	function createMutableHarnessFrameDiagnostics() {
		const startedAtMs = performance.now();
		return {
			longTasks: {
				attribution: createMutableLongTaskAttributionDiagnostics(),
				count: 0,
				maxDurationMs: 0,
				recentEntries: [] as HarnessSlowEvent[],
				supported: false,
				totalDurationMs: 0,
			},
			rendererFrame: createMutableHarnessLoopDiagnostics(),
			runtimeTick: createMutableHarnessLoopDiagnostics(),
			startedAtMs,
		};
	}

	function createMutableLongTaskAttributionDiagnostics(): HarnessLongTaskAttributionDiagnostics {
		return {
			afterStaticReady: createMutableLongTaskBucketDiagnostics(),
			beforeStaticReady: createMutableLongTaskBucketDiagnostics(),
			beforeStaticRequest: createMutableLongTaskBucketDiagnostics(),
			crossingStaticReady: createMutableLongTaskBucketDiagnostics(),
		};
	}

	function createMutableLongTaskBucketDiagnostics(): HarnessLongTaskBucketDiagnostics {
		return {
			count: 0,
			maxDurationMs: 0,
			totalDurationMs: 0,
		};
	}

	function createMutableHarnessLoopDiagnostics() {
		return {
			count: 0,
			lastAtMs: null as number | null,
			maxDeltaMs: 0,
			maxHandlerMs: 0,
			maxRendererHandlerMs: 0,
			over16Ms: 0,
			over33Ms: 0,
			over50Ms: 0,
			over100Ms: 0,
			recentSlowEvents: [] as HarnessSlowEvent[],
			totalHandlerMs: 0,
			totalRendererHandlerMs: 0,
		};
	}

	function recordRuntimeTickStart(atMs: number): void {
		const diagnostics = frameDiagnostics.runtimeTick;
		if (diagnostics.lastAtMs !== null) {
			diagnostics.maxDeltaMs = Math.max(
				diagnostics.maxDeltaMs,
				atMs - diagnostics.lastAtMs,
			);
		}
		diagnostics.lastAtMs = atMs;
		diagnostics.count += 1;
	}

	function recordRuntimeTickEnd(startedAtMs: number, endedAtMs: number): void {
		recordLoopHandlerDuration(
			frameDiagnostics.runtimeTick,
			startedAtMs,
			endedAtMs - startedAtMs,
			"runtime-tick",
		);
	}

	function recordRendererFrameTelemetry(
		telemetry: RendererFrameTelemetry,
	): void {
		const atMs = performance.now();
		const diagnostics = frameDiagnostics.rendererFrame;
		if (diagnostics.lastAtMs !== null) {
			diagnostics.maxDeltaMs = Math.max(
				diagnostics.maxDeltaMs,
				atMs - diagnostics.lastAtMs,
			);
		}
		diagnostics.lastAtMs = atMs;
		diagnostics.count = telemetry.frameCount;
		diagnostics.maxRendererHandlerMs = Math.max(
			diagnostics.maxRendererHandlerMs,
			telemetry.frameHandlerMs,
		);
		diagnostics.totalRendererHandlerMs += telemetry.frameHandlerMs;
		recordLoopHandlerDuration(
			diagnostics,
			atMs,
			telemetry.frameHandlerMs,
			"renderer-frame",
		);
	}

	function recordLoopHandlerDuration(
		diagnostics: ReturnType<typeof createMutableHarnessLoopDiagnostics>,
		atMs: number,
		durationMs: number,
		kind: string,
	): void {
		diagnostics.maxHandlerMs = Math.max(diagnostics.maxHandlerMs, durationMs);
		diagnostics.totalHandlerMs += durationMs;
		if (durationMs > 16) {
			diagnostics.over16Ms += 1;
		}
		if (durationMs > 33) {
			diagnostics.over33Ms += 1;
		}
		if (durationMs > 50) {
			diagnostics.over50Ms += 1;
			appendSlowEvent(diagnostics.recentSlowEvents, {
				atMs,
				durationMs,
				kind,
			});
		}
		if (durationMs > 100) {
			diagnostics.over100Ms += 1;
		}
	}

	function startLongTaskObserver(): void {
		if (
			typeof PerformanceObserver === "undefined" ||
			!PerformanceObserver.supportedEntryTypes.includes("longtask")
		) {
			frameDiagnostics.longTasks.supported = false;
			return;
		}
		frameDiagnostics.longTasks.supported = true;
		longTaskObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				recordLongTask(entry);
			}
		});
		longTaskObserver.observe({ entryTypes: ["longtask"] });
	}

	function stopLongTaskObserver(): void {
		longTaskObserver?.disconnect();
		longTaskObserver = null;
	}

	function recordLongTask(entry: PerformanceEntry): void {
		const diagnostics = frameDiagnostics.longTasks;
		diagnostics.count += 1;
		diagnostics.maxDurationMs = Math.max(
			diagnostics.maxDurationMs,
			entry.duration,
		);
		diagnostics.totalDurationMs += entry.duration;
		recordLongTaskAttribution(entry.startTime, entry.duration);
		appendSlowEvent(diagnostics.recentEntries, {
			atMs: entry.startTime,
			durationMs: entry.duration,
			kind: entry.name || "longtask",
		});
	}

	function recordLongTaskAttribution(atMs: number, durationMs: number): void {
		const startedAtMs = staticReadinessTimeline.lastRequestStartedAtMs;
		const readyAtMs = staticReadinessTimeline.lastReadyAtMs;
		if (startedAtMs === null || atMs < startedAtMs) {
			recordLongTaskBucket(
				frameDiagnostics.longTasks.attribution.beforeStaticRequest,
				durationMs,
			);
			return;
		}
		if (readyAtMs === null) {
			recordLongTaskBucket(
				frameDiagnostics.longTasks.attribution.beforeStaticReady,
				durationMs,
			);
			return;
		}
		if (atMs < readyAtMs && atMs + durationMs > readyAtMs) {
			recordLongTaskBucket(
				frameDiagnostics.longTasks.attribution.crossingStaticReady,
				durationMs,
			);
			return;
		}
		if (atMs >= readyAtMs) {
			recordLongTaskBucket(
				frameDiagnostics.longTasks.attribution.afterStaticReady,
				durationMs,
			);
			return;
		}
		recordLongTaskBucket(
			frameDiagnostics.longTasks.attribution.beforeStaticReady,
			durationMs,
		);
	}

	function recordLongTaskBucket(
		bucket: HarnessLongTaskBucketDiagnostics,
		durationMs: number,
	): void {
		bucket.count += 1;
		bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);
		bucket.totalDurationMs += durationMs;
	}

	function appendSlowEvent(
		events: HarnessSlowEvent[],
		event: HarnessSlowEvent,
	): void {
		events.push(event);
		if (events.length > RECENT_SLOW_EVENT_LIMIT) {
			events.splice(0, events.length - RECENT_SLOW_EVENT_LIMIT);
		}
	}

	function createHarnessFrameDiagnosticsSnapshot(): HarnessFrameDiagnostics {
		const nowMs = performance.now();
		return {
			elapsedMs: nowMs - frameDiagnostics.startedAtMs,
			longTasks: {
				...frameDiagnostics.longTasks,
				attribution: createHarnessLongTaskAttributionSnapshot(
					frameDiagnostics.longTasks.attribution,
				),
			},
			rendererFrame: createHarnessLoopDiagnosticsSnapshot(
				frameDiagnostics.rendererFrame,
			),
			runtimeTick: createHarnessLoopDiagnosticsSnapshot(
				frameDiagnostics.runtimeTick,
			),
			staticReadiness: { ...staticReadinessTimeline },
			startedAtMs: frameDiagnostics.startedAtMs,
		};
	}

	function createHarnessLongTaskAttributionSnapshot(
		attribution: HarnessLongTaskAttributionDiagnostics,
	): HarnessLongTaskAttributionDiagnostics {
		return {
			afterStaticReady: { ...attribution.afterStaticReady },
			beforeStaticReady: { ...attribution.beforeStaticReady },
			beforeStaticRequest: { ...attribution.beforeStaticRequest },
			crossingStaticReady: { ...attribution.crossingStaticReady },
		};
	}

	function createHarnessLoopDiagnosticsSnapshot(
		diagnostics: ReturnType<typeof createMutableHarnessLoopDiagnostics>,
	): HarnessRendererFrameDiagnostics {
		return {
			count: diagnostics.count,
			maxDeltaMs: diagnostics.maxDeltaMs,
			maxHandlerMs: diagnostics.maxHandlerMs,
			maxRendererHandlerMs: diagnostics.maxRendererHandlerMs,
			over16Ms: diagnostics.over16Ms,
			over33Ms: diagnostics.over33Ms,
			over50Ms: diagnostics.over50Ms,
			over100Ms: diagnostics.over100Ms,
			recentSlowEvents: [...diagnostics.recentSlowEvents],
			totalHandlerMs: diagnostics.totalHandlerMs,
			totalRendererHandlerMs: diagnostics.totalRendererHandlerMs,
		};
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
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
			"Courier New", monospace;
		font-size: 12px;
		left: 12px;
		padding: 6px 8px;
		position: absolute;
		top: 12px;
	}
</style>
