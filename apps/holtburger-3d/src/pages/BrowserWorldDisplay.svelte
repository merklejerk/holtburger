<script lang="ts">
	import { onDestroy } from "svelte";

	import { frontendState } from "../app/frontend-state";
	import type { BrowserLocationSelection } from "../app/browser-mode";
	import type { AppModeId } from "../app/modes";
	import type { AssetChannelState } from "../lib/assets/types";
	import type {
		CameraHintAckDto,
		FrontendStateFeedDto,
		RayPickResponseDto,
		RuntimeBatchDto,
	} from "../lib/host/contracts";
	import { resolveRayPick, submitCameraHint } from "../lib/host/tauri";
	import {
		buildCameraHintFromSceneCameraFrame,
		buildDebugOrbitCameraFrame,
		createDebugOrbitCameraState,
		fitDebugOrbitCameraToBounds,
		orbitDebugCamera,
		panDebugCamera,
		zoomDebugCamera,
		type DebugOrbitCameraState,
		type SceneCameraFrame,
		describeSceneCameraFrame,
	} from "../lib/world-display/camera";
	import WorldDisplay from "../lib/world-display/WorldDisplay.svelte";
	import {
		buildCameraHint,
		buildRayPickRequest,
		deriveWorldDisplayModel,
		describeCameraHintAck,
		describeRayPickResponse,
		normalizeViewportPoint,
		shouldSendThrottledCameraHint,
		type NormalizedViewportPoint,
	} from "../lib/world-display/model";
	import type { WorldRenderMetrics } from "../lib/world-display/renderer-contract";
	import {
		deriveStaticRenderableSceneModel,
		isPreparedGfxObjAsset,
	} from "../lib/world-display/static-renderables";
	import { deriveTerrainSceneModel } from "../lib/world-display/terrain-scene";
	import { deriveStructuredInteriorSceneModel } from "../lib/world-display/structured-interior-scene";

	let {
		activeMode,
		activeModeLabel,
		hostStatus,
		runtimeBatch,
		viewModelFeed,
		assetState,
		browserDestination,
		landblockCoverageRadius,
	}: {
		activeMode: AppModeId;
		activeModeLabel: string;
		hostStatus: string;
		runtimeBatch: RuntimeBatchDto | null;
		viewModelFeed: FrontendStateFeedDto | null;
		assetState: AssetChannelState;
		browserDestination: BrowserLocationSelection | null;
		landblockCoverageRadius: number;
	} = $props();

	let rootElement = $state<HTMLDivElement | null>(null);
	let worldDisplaySurface = $state<WorldDisplay | null>(null);
	let renderMetrics = $state<WorldRenderMetrics | null>(null);
	let browserCameraState = $state<DebugOrbitCameraState>(
		createDebugOrbitCameraState(),
	);
	let browserCameraFrame = $state<SceneCameraFrame | null>(null);
	let cameraAck = $state<CameraHintAckDto | null>(null);
	let rayPickResponse = $state<RayPickResponseDto | null>(null);
	let lastCameraHintAt = $state<number | null>(null);
	let trailingCameraHint = $state<ReturnType<typeof buildCameraHint> | null>(
		null,
	);
	let activePointerDrag = $state<{
		pointerId: number;
		lastX: number;
		lastY: number;
		mode: "orbit" | "pan";
		moved: boolean;
	} | null>(null);
	let suppressNextBrowserClick = false;
	let cameraHintTimer: ReturnType<typeof setTimeout> | null = null;

	const CAMERA_HINT_INTERVAL_MS = 250;

	const terrainScene = $derived(
		deriveTerrainSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			landblockCoverageRadius,
		),
	);
	const staticRenderableScene = $derived(
		deriveStaticRenderableSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			landblockCoverageRadius,
		),
	);
	const structuredInteriorScene = $derived(
		deriveStructuredInteriorSceneModel(runtimeBatch, assetState),
	);
	const terrainVertexCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.vertices.length,
			0,
		),
	);
	const terrainTriangleCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.triangles.length,
			0,
		),
	);
	const terrainMinHeight = $derived(
		terrainScene.tiles.length === 0
			? null
			: Math.min(...terrainScene.tiles.map((tile) => tile.mesh.minHeight)),
	);
	const terrainMaxHeight = $derived(
		terrainScene.tiles.length === 0
			? null
			: Math.max(...terrainScene.tiles.map((tile) => tile.mesh.maxHeight)),
	);
	const sceneGeometryText = $derived(
		structuredInteriorScene.cells.length > 0
			? `${structuredInteriorScene.cells.length} env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"}, ${renderMetrics?.geometry.structuredInteriorVertexCount ?? 0} vertices, ${renderMetrics?.geometry.structuredInteriorTriangleCount ?? 0} triangles.`
			: terrainScene.tiles.length === 0
				? "No terrain geometry is cached yet."
				: `${terrainScene.tiles.length} tile${terrainScene.tiles.length === 1 ? "" : "s"}, ${terrainVertexCount} vertices, ${terrainTriangleCount} triangles.`,
	);
	const terrainHeightText = $derived(
		terrainMinHeight === null || terrainMaxHeight === null
			? "No terrain heights are cached yet."
			: `Height range ${terrainMinHeight.toFixed(1)} to ${terrainMaxHeight.toFixed(1)} across cached tiles.`,
	);
	const staticRenderableText = $derived(
		staticRenderableScene.parts.length === 0
			? describeStaticRenderableIdleState()
			: `${staticRenderableScene.parts.length} static renderable part${staticRenderableScene.parts.length === 1 ? "" : "s"} across ${staticRenderableScene.partsByGfxAssetId.size} shared gfx geometr${staticRenderableScene.partsByGfxAssetId.size === 1 ? "y" : "ies"}.`,
	);
	const staticRenderableLayerText = $derived.by(() => {
		const explicitCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "scenery",
		).length;
		const buildingCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "building",
		).length;
		const generatedCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "generated-scenery",
		).length;
		return `Explicit ${explicitCount}, buildings ${buildingCount}, generated ${generatedCount}.`;
	});
	const structuredInteriorEnvironmentCount = $derived(
		new Set(structuredInteriorScene.cells.map((cell) => cell.environmentId))
			.size,
	);
	const structuredInteriorText = $derived(
		structuredInteriorScene.cells.length > 0
			? `${structuredInteriorScene.cells.length} visible env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} rendered from ${structuredInteriorEnvironmentCount} environment payload${structuredInteriorEnvironmentCount === 1 ? "" : "s"}.`
			: describeStructuredInteriorIdleState(),
	);
	const sceneBoundsText = $derived(
		renderMetrics?.bounds
			? `Center (${renderMetrics.bounds.center.x.toFixed(1)}, ${renderMetrics.bounds.center.y.toFixed(1)}, ${renderMetrics.bounds.center.z.toFixed(1)}) span (${renderMetrics.bounds.size.x.toFixed(1)}, ${renderMetrics.bounds.size.y.toFixed(1)}, ${renderMetrics.bounds.size.z.toFixed(1)}).`
			: "Scene bounds are unavailable until terrain is framed.",
	);
	const cameraFrameText = $derived(
		browserCameraFrame
			? `${describeSceneCameraFrame(browserCameraFrame)} ${describeBrowserCameraControlMode()}`
			: "Camera frame is waiting for terrain.",
	);
	const assetDebugText = $derived(describeAssetDebugState());
	const pendingCameraHint = $derived(trailingCameraHint !== null);
	const worldDisplay = $derived(
		deriveWorldDisplayModel({
			activeModeLabel,
			hostStatus,
			runtimeBatch,
			viewModelFeed,
			assetState,
			browserDestination,
			landblockCoverageRadius,
			cameraAck,
			rayPickResponse,
			pendingCameraHint,
		}),
	);

	// Browser orbit controls are a debug/navigation policy, not the future client camera.
	function handleRenderMetricsChange(metrics: WorldRenderMetrics): void {
		renderMetrics = metrics;

		if (metrics.bounds) {
			const fitKey = [
				metrics.bounds.center.x.toFixed(2),
				metrics.bounds.center.y.toFixed(2),
				metrics.bounds.center.z.toFixed(2),
				metrics.bounds.size.x.toFixed(2),
				metrics.bounds.size.y.toFixed(2),
				metrics.bounds.size.z.toFixed(2),
				metrics.geometry.terrainTileCount,
				metrics.geometry.staticRenderablePartCount,
			].join(":");
			browserCameraState = fitDebugOrbitCameraToBounds(
				browserCameraState,
				metrics.bounds,
				fitKey,
				{ force: false },
			);
			applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, false);
			return;
		}

		if (!browserCameraFrame && metrics.cameraFrame) {
			browserCameraFrame = metrics.cameraFrame;
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function handleRendererCameraFrameChange(
		cameraFrame: SceneCameraFrame,
	): void {
		if (!browserCameraFrame) {
			browserCameraFrame = cameraFrame;
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function handleBrowserPointerDownCapture(event: PointerEvent): void {
		if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
			return;
		}

		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		activePointerDrag = {
			pointerId: event.pointerId,
			lastX: event.clientX,
			lastY: event.clientY,
			mode: event.button === 0 ? "orbit" : "pan",
			moved: false,
		};
		event.preventDefault();
	}

	function handleBrowserPointerMoveCapture(event: PointerEvent): void {
		const drag = activePointerDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		const delta = {
			x: event.clientX - drag.lastX,
			y: event.clientY - drag.lastY,
		};
		if (delta.x === 0 && delta.y === 0) {
			return;
		}

		activePointerDrag = {
			...drag,
			lastX: event.clientX,
			lastY: event.clientY,
			moved: drag.moved || Math.hypot(delta.x, delta.y) > 2,
		};
		browserCameraState =
			drag.mode === "orbit"
				? orbitDebugCamera(browserCameraState, delta)
				: panDebugCamera(browserCameraState, delta);
		applyBrowserCameraFrame(getViewportPoint(event), false);
		event.preventDefault();
	}

	function handleBrowserPointerUpCapture(event: PointerEvent): void {
		const drag = activePointerDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		suppressNextBrowserClick = drag.moved;
		activePointerDrag = null;
		event.preventDefault();
	}

	function handleBrowserWheelCapture(event: WheelEvent): void {
		browserCameraState = zoomDebugCamera(browserCameraState, event.deltaY);
		applyBrowserCameraFrame(getViewportPoint(event), false);
		event.preventDefault();
	}

	function handleBrowserKeyDownCapture(event: KeyboardEvent): void {
		if (event.key.toLowerCase() !== "f" || !renderMetrics?.bounds) {
			return;
		}

		browserCameraState = fitDebugOrbitCameraToBounds(
			browserCameraState,
			renderMetrics.bounds,
			`forced:${Date.now()}`,
			{ force: true },
		);
		applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		event.preventDefault();
	}

	function handleBrowserContextMenuCapture(event: MouseEvent): void {
		event.preventDefault();
	}

	async function handleBrowserClickCapture(event: MouseEvent): Promise<void> {
		if (suppressNextBrowserClick) {
			suppressNextBrowserClick = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (!event.ctrlKey || !rootElement || !worldDisplaySurface) {
			return;
		}

		const viewportPoint = getViewportPoint(event);

		if (!event.ctrlKey) {
			const hint = buildRenderedCameraHint(viewportPoint);
			if (!hint) {
				return;
			}

			await flushCameraHint(hint);
			rayPickResponse = await resolveRayPick(
				buildRayPickRequest(hint, `browser-world-display-pick-${Date.now()}`),
			);
			return;
		}

		const landblockId =
			worldDisplaySurface.pickTerrainLandblockAtViewportPoint(viewportPoint);

		if (landblockId === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		frontendState.selectBrowserLandblockDestination(landblockId);
	}

	function applyBrowserCameraFrame(
		viewportPoint: NormalizedViewportPoint,
		immediate: boolean,
	): void {
		browserCameraFrame = {
			...buildDebugOrbitCameraFrame(browserCameraState),
			aspect:
				renderMetrics?.cameraFrame?.aspect ?? browserCameraFrame?.aspect ?? 1,
		};
		scheduleRenderedCameraHint(viewportPoint, immediate);
	}

	function getViewportPoint(
		event: MouseEvent | PointerEvent | WheelEvent,
	): NormalizedViewportPoint {
		if (!rootElement) {
			return { normalizedX: 0.5, normalizedY: 0.5 };
		}

		const rect = rootElement.getBoundingClientRect();
		return normalizeViewportPoint(
			event.clientX - rect.left,
			event.clientY - rect.top,
			rect.width,
			rect.height,
		);
	}

	function scheduleRenderedCameraHint(
		viewportPoint: NormalizedViewportPoint,
		immediate: boolean,
	): void {
		const hint = buildRenderedCameraHint(viewportPoint);

		if (!hint) {
			return;
		}

		scheduleCameraHint(hint, immediate);
	}

	function buildRenderedCameraHint(
		viewportPoint: NormalizedViewportPoint,
	): NonNullable<ReturnType<typeof buildCameraHint>> | null {
		if (!browserCameraFrame) {
			return buildCameraHint(
				activeMode,
				runtimeBatch,
				browserDestination,
				viewportPoint,
			);
		}

		return buildCameraHintFromSceneCameraFrame(
			activeMode,
			runtimeBatch,
			browserDestination,
			browserCameraFrame,
			viewportPoint,
		);
	}

	function scheduleCameraHint(
		hint: NonNullable<ReturnType<typeof buildCameraHint>>,
		immediate: boolean,
	): void {
		const now = Date.now();

		if (
			immediate ||
			shouldSendThrottledCameraHint(
				lastCameraHintAt,
				now,
				CAMERA_HINT_INTERVAL_MS,
			)
		) {
			if (cameraHintTimer) {
				clearTimeout(cameraHintTimer);
				cameraHintTimer = null;
			}
			trailingCameraHint = null;
			void flushCameraHint(hint);
			return;
		}

		trailingCameraHint = hint;

		if (cameraHintTimer) {
			return;
		}

		const remainingDelay =
			CAMERA_HINT_INTERVAL_MS - (now - (lastCameraHintAt ?? now));
		cameraHintTimer = setTimeout(
			() => {
				cameraHintTimer = null;
				const nextHint = trailingCameraHint;
				trailingCameraHint = null;

				if (nextHint) {
					void flushCameraHint(nextHint);
				}
			},
			Math.max(remainingDelay, 0),
		);
	}

	async function flushCameraHint(
		hint: NonNullable<ReturnType<typeof buildCameraHint>>,
	): Promise<void> {
		cameraAck = await submitCameraHint(hint);
		lastCameraHintAt = Date.now();
	}

	function describeBrowserCameraControlMode(): string {
		return browserCameraState.hasManualControl
			? "Browser camera: manual orbit."
			: "Browser camera: auto-fit.";
	}

	function describeAssetDebugState(): string {
		if (assetState.errorMessage) {
			return `Error while preparing ${assetState.activeRequest?.assetId ?? "asset"}: ${assetState.errorMessage}`;
		}

		const preparedCount = Object.keys(assetState.preparedByAssetId).length;
		const activeAssetId = assetState.activeRequest?.assetId ?? "none";
		const recentActivity = assetState.history.at(-1);
		const recentText = recentActivity
			? `${recentActivity.status} ${recentActivity.assetId}`
			: "no asset activity yet";
		const renderDiagnostic = describeGfxObjRenderDiagnostics();
		if (renderDiagnostic) {
			return `${assetState.status}; ${renderDiagnostic}; active ${activeAssetId}; prepared ${preparedCount}; latest ${recentText}.`;
		}

		return `${assetState.status}; active ${activeAssetId}; prepared ${preparedCount}; latest ${recentText}.`;
	}

	function describeGfxObjRenderDiagnostics(): string | null {
		const affectedAssets = Object.values(assetState.preparedByAssetId)
			.filter(isPreparedGfxObjAsset)
			.map((asset) => ({
				assetId: asset.request.assetId,
				invalidPolygons: asset.payload.renderGeometry.invalidPolygons ?? [],
			}))
			.filter((asset) => asset.invalidPolygons.length > 0);

		if (affectedAssets.length === 0) {
			return null;
		}

		const firstAsset = affectedAssets[0];
		const firstPolygon = firstAsset?.invalidPolygons[0];
		const totalInvalidPolygons = affectedAssets.reduce(
			(total, asset) => total + asset.invalidPolygons.length,
			0,
		);

		if (!firstAsset || !firstPolygon) {
			return null;
		}

		return `${totalInvalidPolygons} invalid gfx polygon${totalInvalidPolygons === 1 ? "" : "s"} while preparing ${affectedAssets.length} gfx asset${affectedAssets.length === 1 ? "" : "s"}; first ${firstAsset.assetId} polygon ${firstPolygon.polygonId} missing vertices ${firstPolygon.missingVertexIds.join(", ")}`;
	}

	function describeStaticRenderableIdleState(): string {
		if (staticRenderableScene.sourceInstances.length === 0) {
			return "No static renderable source facts are active for the current outdoor coverage.";
		}

		if (staticRenderableScene.missingSourceAssetIds.length > 0) {
			return `Waiting for ${staticRenderableScene.missingSourceAssetIds.length} static renderable source asset${staticRenderableScene.missingSourceAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (staticRenderableScene.missingGfxAssetIds.length > 0) {
			return `Waiting for ${staticRenderableScene.missingGfxAssetIds.length} gfx geometry dependenc${staticRenderableScene.missingGfxAssetIds.length === 1 ? "y" : "ies"}.`;
		}

		return "Static renderable source facts are active, but no drawable gfx geometry is ready.";
	}

	function describeStructuredInteriorIdleState(): string {
		if (!runtimeBatch?.residency.indoors) {
			return "Structured interior rendering is dormant while outdoor residency is active.";
		}

		if (structuredInteriorScene.missingEnvCellAssetIds.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingEnvCellAssetIds.length} visible env-cell metadata payload${structuredInteriorScene.missingEnvCellAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (structuredInteriorScene.missingEnvironmentAssetIds.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingEnvironmentAssetIds.length} environment geometry payload${structuredInteriorScene.missingEnvironmentAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (structuredInteriorScene.missingCellStructureKeys.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingCellStructureKeys.length} selected cell-structure match${structuredInteriorScene.missingCellStructureKeys.length === 1 ? "" : "es"}.`;
		}

		return "Structured interior source facts are active, but no drawable cell geometry is ready.";
	}

	onDestroy(() => {
		if (cameraHintTimer) {
			clearTimeout(cameraHintTimer);
		}
	});
</script>

<div
	bind:this={rootElement}
	class="browser-world-display"
	onpointerdowncapture={handleBrowserPointerDownCapture}
	onpointermovecapture={handleBrowserPointerMoveCapture}
	onpointerupcapture={handleBrowserPointerUpCapture}
	onpointercancelcapture={handleBrowserPointerUpCapture}
	onwheelcapture={handleBrowserWheelCapture}
	onkeydowncapture={handleBrowserKeyDownCapture}
	oncontextmenucapture={handleBrowserContextMenuCapture}
	onclickcapture={handleBrowserClickCapture}
>
	<WorldDisplay
		bind:this={worldDisplaySurface}
		{assetState}
		{terrainScene}
		{staticRenderableScene}
		{structuredInteriorScene}
		controlledCameraFrame={browserCameraFrame}
		onCameraFrameChange={handleRendererCameraFrameChange}
		onRenderMetricsChange={handleRenderMetricsChange}
	/>

	<div class="world-display__hud world-display__hud--top-left">
		<p class="world-display__eyebrow">Scene</p>
		<dl class="world-display__hud-list">
			<div>
				<dt>Focus</dt>
				<dd>{worldDisplay.focusLocationLabel}</dd>
			</div>
			<div>
				<dt>Coverage</dt>
				<dd>{terrainScene.cacheText}</dd>
			</div>
			<div>
				<dt>Source</dt>
				<dd>{terrainScene.dataSourceText}</dd>
			</div>
			<div>
				<dt>Geometry</dt>
				<dd>{sceneGeometryText}</dd>
			</div>
			<div>
				<dt>Assets</dt>
				<dd>{assetDebugText}</dd>
			</div>
			<div>
				<dt>Statics</dt>
				<dd>{staticRenderableText}</dd>
			</div>
			<div>
				<dt>Interiors</dt>
				<dd>{structuredInteriorText}</dd>
			</div>
			<div>
				<dt>Layers</dt>
				<dd>{staticRenderableLayerText}</dd>
			</div>
			<div>
				<dt>Heights</dt>
				<dd>{terrainHeightText}</dd>
			</div>
			<div>
				<dt>Bounds</dt>
				<dd>{sceneBoundsText}</dd>
			</div>
			<div>
				<dt>Camera</dt>
				<dd>{cameraFrameText}</dd>
			</div>
		</dl>
	</div>

	<div class="world-display__viewport-copy">
		<p>
			{structuredInteriorScene.cells.length > 0
				? structuredInteriorScene.statusText
				: terrainScene.statusText}
		</p>
		<p>{worldDisplay.inputText}</p>
	</div>

	<div class="world-display__telemetry">
		<p>
			Camera hint:{" "}
			{describeCameraHintAck(cameraAck) ??
				"Waiting for the first world-display camera hint acknowledgement."}
		</p>
		<p>
			Ray pick:{" "}
			{describeRayPickResponse(rayPickResponse) ??
				"No authority-sensitive debug pick has been resolved yet."}
		</p>
	</div>
</div>
