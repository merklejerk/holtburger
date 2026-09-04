<script lang="ts" module>
	/**
	 * Bezel thickness as a fraction of the widget's diameter.
	 *
	 * Proportional rather than a fixed pixel width so the frame, its cardinal letters, and the map
	 * disc scale together when the widget is resized, the way one piece of compass art would.
	 */
	const RIM_FRACTION = 0.055;
	/** Map disc radius in the compass viewBox's units, where the frame's outer edge is 100. */
	const DISC_RADIUS = 100 - RIM_FRACTION * 200;
	/**
	 * Cardinal letters are centred on the frame's outer edge, so they spill past it.
	 *
	 * The bezel is too narrow to hold a letter worth reading, and letters that overhang the rim stay
	 * legible without widening the frame to accommodate them. The compass SVG therefore draws
	 * outside its own viewBox, which is why it is the one element allowed to overflow.
	 */
	const CARDINAL_RADIUS = 100;
	/** From any origin inside the disc, two radii reach every point on its rim. */
	const CONE_LENGTH = DISC_RADIUS * 2;

	/** Wedge from the subject spanning one field of view, in the compass viewBox's units. */
	function conePath(fovRadians: number): string {
		const half = Math.max(0.05, Math.min(Math.PI - 0.05, fovRadians)) / 2;
		const x = Math.sin(half) * CONE_LENGTH;
		const y = -Math.cos(half) * CONE_LENGTH;
		return `M 0 0 L ${-x} ${y} A ${CONE_LENGTH} ${CONE_LENGTH} 0 0 1 ${x} ${y} Z`;
	}

	/** Controlled-character arrow dimensions in canvas pixels. */
	const CONTROLLED_ARROW_LENGTH = 11;
	const CONTROLLED_ARROW_HALF_WIDTH = 5;
	/** Generous pointer target around deliberately small map markers. */
	const BLIP_HIT_RADIUS = 8;
	/** Gap between a marker and its selected-identity ring. */
	const SELECTED_BLIP_RING_GAP = 3;
	/** Ignore click-scale pointer jitter before detaching the viewed centre. */
	const MINIMAP_PAN_DRAG_THRESHOLD_PIXELS = 3;
</script>

<script lang="ts">
	import { onDestroy, onMount } from "svelte";

	import { trackPointerGesture } from "./pointer-gesture";
	import { MapRenderer } from "../lib/game/map/map-renderer";
	import { selectMapBlips } from "../lib/game/map/map-blips";
	import {
		MAP_BLIP_FILL_COLORS,
		MAP_BLIP_RADIUS_PIXELS,
		mapBlipFillStyle,
	} from "../lib/game/map/map-appearance";
	import {
		type MapViewParameters,
		clampMapViewDiameter,
		mapCenterAfterCanvasDrag,
		mapEnvironment,
		projectMapView,
		projectMapWorldPoint,
		type ProjectedMapView,
	} from "../lib/game/map/map-view";
	import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";
	import {
		captureMinimapGpuDrawState,
		MINIMAP_MINIMUM_SIZE,
		minimapViewDiameter,
		sameMinimapGpuDrawState,
		type MinimapFrame,
		type MinimapGpuDrawState,
		type MinimapState,
		type MinimapSubject,
	} from "./minimap-frame";
	import {
		ANCHORED_MINIMAP_PAN_STATE,
		detachMinimapPan,
		minimapPanCenter,
		reanchorMinimapPanAfterSubjectTravel,
		type MinimapPanState,
	} from "./minimap-pan-policy";
	import {
		EMPTY_MINIMAP_BREADCRUMB_TRAIL,
		observeMinimapBreadcrumbTrail,
		type MinimapBreadcrumbTrail,
	} from "./minimap-breadcrumb-trail";
	import { drawMinimapBreadcrumbTrail } from "./minimap-breadcrumb-renderer";
	import { closestMinimapSelectionGuid } from "./minimap-selection";
	import {
		MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
		MINIMAP_BREADCRUMB_POLICY,
	} from "./minimap-tuning";

	/** One rendered marker's canvas-space interaction geometry. */
	interface BlipHitTarget {
		/** Source entity selected when this marker wins deterministic hit testing. */
		readonly guid: number;
		/** Display label shown while this marker is hovered. */
		readonly name: string;
		/** Horizontal coordinate in canvas backing-store pixels. */
		readonly x: number;
		/** Vertical coordinate in canvas backing-store pixels. */
		readonly y: number;
	}

	/** Last pointer position in viewport space, retained while presentation targets move. */
	interface BlipHoverPoint {
		/** Horizontal pointer coordinate in viewport CSS pixels. */
		readonly clientX: number;
		/** Vertical pointer coordinate in viewport CSS pixels. */
		readonly clientY: number;
	}

	/** Tooltip content and placement relative to the map frame. */
	interface BlipTooltip {
		/** Horizontal tooltip coordinate in map-frame CSS pixels. */
		readonly left: number;
		/** Deduplicated labels for every marker under the pointer. */
		readonly names: readonly string[];
		/** Vertical tooltip coordinate in map-frame CSS pixels. */
		readonly top: number;
	}

	/** Fixed inputs captured at pointer-down so one drag cannot warp as live presentation changes. */
	interface MinimapPanGesture {
		/** Pointer exclusively owning this drag. */
		readonly pointerId: number;
		/** Horizontal viewport coordinate where the drag began. */
		readonly startClientX: number;
		/** Vertical viewport coordinate where the drag began. */
		readonly startClientY: number;
		/** CSS width whose coordinate scale the captured drag uses. */
		readonly canvasWidth: number;
		/** CSS height whose coordinate scale the captured drag uses. */
		readonly canvasHeight: number;
		/** Subject identity and position that arm automatic re-anchoring. */
		readonly subject: MinimapSubject;
		/** Complete starting view from which total pointer displacement is projected. */
		readonly view: MapViewParameters;
	}

	interface Props {
		/**
		 * Pull every presentation-rate input in one snapshot.
		 *
		 * This is deliberately imperative. The scene must not schedule Svelte work just because a
		 * camera or entity moved; overlays pull at display cadence and the WebGL map pulls at its cap.
		 */
		readonly readFrame: () => MinimapFrame;
		readonly viewState: MinimapState;
		/** Whether shell-owned placement and sizing controls are currently available. */
		readonly editable: boolean;
		readonly onStateChange: (state: MinimapState) => void;
		/** Apply one completed marker click, or clear selection for an empty click. */
		readonly onSelectEntity: (guid: number | null) => void;
	}

	const {
		readFrame,
		viewState,
		editable,
		onStateChange,
		onSelectEntity,
	}: Props = $props();

	/** No faster than this; only the expensive WebGL map picture is cadence-limited. */
	const MINIMUM_GPU_FRAME_INTERVAL_MS = 1000 / 30;

	let mapCanvas = $state<HTMLCanvasElement | null>(null);
	let overlayCanvas = $state<HTMLCanvasElement | null>(null);
	let coneElement = $state<SVGPathElement | null>(null);
	let northGroup = $state<SVGGElement | null>(null);
	let freeAnchorElement = $state<SVGCircleElement | null>(null);
	let coordinatesElement = $state<HTMLSpanElement | null>(null);
	let tooltip = $state<BlipTooltip | null>(null);
	/** Cold markup projection; cursor-rate pan coordinates remain in imperative `minimapPanState`. */
	let minimapDetached = $state(false);
	let renderer: MapRenderer | null = null;
	let rendererSource: MinimapFrame["source"] = null;
	let blipHitTargets: readonly BlipHitTarget[] = [];
	let blipHoverPoint: BlipHoverPoint | null = null;
	let minimapPanState: MinimapPanState = ANCHORED_MINIMAP_PAN_STATE;
	let minimapPanGesture: MinimapPanGesture | null = null;
	let breadcrumbTrail: MinimapBreadcrumbTrail = EMPTY_MINIMAP_BREADCRUMB_TRAIL;
	let cancelPointerGesture: (() => void) | null = null;
	onDestroy(() => {
		cancelPointerGesture?.();
		cancelMinimapPan();
	});

	onMount(() => {
		let frameHandle: number | undefined;
		let lastGpuAttemptedAt = Number.NEGATIVE_INFINITY;
		let lastGpuDrawn: MinimapGpuDrawState | null = null;
		const step = (now: number): void => {
			frameHandle = window.requestAnimationFrame(step);
			const frame = readFrame();
			breadcrumbTrail = observeMinimapBreadcrumbTrail(
				breadcrumbTrail,
				frame.subject,
				MINIMAP_BREADCRUMB_POLICY,
			);
			if (minimapPanGesture === null) {
				replaceMinimapPanState(
					reanchorMinimapPanAfterSubjectTravel(
						minimapPanState,
						frame.subject,
						MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
					),
				);
			}
			const parameters = view(frame);
			const size = discPixelSize();
			drawOverlay(frame, parameters, size);
			const next = captureMinimapGpuDrawState(frame, viewState, parameters);
			if (sameMinimapGpuDrawState(lastGpuDrawn, next)) return;
			if (now - lastGpuAttemptedAt < MINIMUM_GPU_FRAME_INTERVAL_MS) return;
			lastGpuAttemptedAt = now;
			if (drawMap(frame, parameters, size)) {
				lastGpuDrawn = next;
			}
		};
		frameHandle = window.requestAnimationFrame(step);
		return () => {
			if (frameHandle !== undefined) window.cancelAnimationFrame(frameHandle);
			renderer?.destroy();
			renderer = null;
			rendererSource = null;
		};
	});

	function view(frame: MinimapFrame): MapViewParameters | null {
		const anchor = frame.subject?.anchor;
		if (!anchor) return null;
		return {
			anchor,
			center: minimapPanCenter(minimapPanState, frame.subject),
			viewDiameter: clampMapViewDiameter(
				minimapViewDiameter(viewState, anchor),
			),
		};
	}

	/**
	 * Pixel size of the map disc, which is the widget inset by the bezel on both sides.
	 *
	 * The drawn map is square and the disc clips it to a circle, so this is what both canvases are
	 * sized to. The widget's own size stays the outer diameter, which the resize stud changes.
	 */
	function discPixelSize(): number {
		return Math.max(1, Math.round(viewState.size * (1 - 2 * RIM_FRACTION)));
	}

	/** Draw DOM and 2D overlay work at the display's animation cadence. */
	function drawOverlay(
		frame: MinimapFrame,
		parameters: MapViewParameters | null,
		size: number,
	): void {
		if (parameters === null) {
			drawChrome(frame, null);
			clearOverlayCanvas();
			return;
		}
		const overlay = projectMapView(parameters, size, size);
		drawChrome(frame, overlay);
		drawCanvasOverlay(frame, overlay, size);
	}

	/** Draw only the map content that requires WebGL, subject to the 30 Hz cap. */
	function drawMap(
		frame: MinimapFrame,
		parameters: MapViewParameters | null,
		size: number,
	): boolean {
		reconcileRenderer(frame.source);
		const canvas = mapCanvas;
		if (!parameters || !canvas || !frame.source) {
			clearMapCanvas();
			return true;
		}
		if (canvas.width !== size || canvas.height !== size) {
			canvas.width = size;
			canvas.height = size;
		}
		if (!renderer?.render(parameters)) return false;
		return true;
	}

	function reconcileRenderer(source: MinimapFrame["source"]): void {
		if (rendererSource === source) return;
		renderer?.destroy();
		renderer = null;
		rendererSource = source;
		if (source && mapCanvas) renderer = new MapRenderer(mapCanvas, source);
	}

	function clearMapCanvas(): void {
		// Resetting the drawing buffer is the context-neutral way to clear the WebGL map canvas.
		if (mapCanvas) mapCanvas.width = mapCanvas.width;
	}

	function clearOverlayCanvas(): void {
		blipHitTargets = [];
		reconcileBlipTooltip();
		const context = overlayCanvas?.getContext("2d");
		if (overlayCanvas) {
			context?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
		}
	}

	/**
	 * Breadcrumbs and blips are drawn in 2D above the map rather than in its GL pass.
	 *
	 * They want crisp UI styling and they change for different reasons than geometry does, so
	 * keeping them here lets a future client restyle markers without touching a shader.
	 */
	function drawCanvasOverlay(
		frame: MinimapFrame,
		overlay: ProjectedMapView,
		size: number,
	): void {
		const canvas = overlayCanvas;
		if (!canvas) return;
		if (canvas.width !== size || canvas.height !== size) {
			canvas.width = size;
			canvas.height = size;
		}
		const context = canvas.getContext("2d");
		if (!context) return;
		context.clearRect(0, 0, size, size);
		drawMinimapBreadcrumbTrail(context, breadcrumbTrail, overlay, size);
		const hitTargets: BlipHitTarget[] = [];
		const environment = mapEnvironment(overlay.view.anchor);
		for (const blip of selectMapBlips(
			frame.presentedEntities(),
			overlay,
			frame.subject?.kind === "controlled-entity" ? frame.subject.guid : null,
		)) {
			// Clip space is [-1, 1] with +Y up; canvas pixels run down from the top-left.
			const x = ((blip.clipX + 1) / 2) * size;
			const y = ((1 - blip.clipY) / 2) * size;
			hitTargets.push({ guid: blip.guid, name: blip.name, x, y });
			if (blip.appearance.category === "controlled") {
				drawControlledArrow(context, x, y, blip.appearance.headingRadians);
				drawSelectedBlipRing(context, frame, blip.guid, x, y);
				continue;
			}
			context.beginPath();
			context.arc(x, y, MAP_BLIP_RADIUS_PIXELS, 0, Math.PI * 2);
			context.fillStyle = mapBlipFillStyle(
				blip.appearance.category,
				blip.appearance.heightOffsetMeters,
				environment,
			);
			context.fill();
			context.lineWidth = 1;
			context.strokeStyle = "rgba(0, 0, 0, 0.65)";
			context.stroke();
			drawSelectedBlipRing(context, frame, blip.guid, x, y);
		}
		blipHitTargets = hitTargets;
		reconcileBlipTooltip();
	}

	function drawSelectedBlipRing(
		context: CanvasRenderingContext2D,
		frame: MinimapFrame,
		guid: number,
		x: number,
		y: number,
	): void {
		if (frame.selectedGuid !== guid) return;
		context.beginPath();
		context.arc(
			x,
			y,
			Math.max(CONTROLLED_ARROW_HALF_WIDTH, MAP_BLIP_RADIUS_PIXELS) +
				SELECTED_BLIP_RING_GAP,
			0,
			Math.PI * 2,
		);
		context.lineWidth = 2;
		context.strokeStyle = "rgba(255, 244, 128, 0.95)";
		context.stroke();
	}

	/** Draw the controlled character as an arrowhead pointing along its map-relative heading. */
	function drawControlledArrow(
		context: CanvasRenderingContext2D,
		x: number,
		y: number,
		headingRadians: number,
	): void {
		context.save();
		context.translate(x, y);
		context.rotate(headingRadians);
		context.beginPath();
		context.moveTo(0, -CONTROLLED_ARROW_LENGTH / 2);
		context.lineTo(CONTROLLED_ARROW_HALF_WIDTH, CONTROLLED_ARROW_LENGTH / 2);
		context.lineTo(0, CONTROLLED_ARROW_LENGTH / 4);
		context.lineTo(-CONTROLLED_ARROW_HALF_WIDTH, CONTROLLED_ARROW_LENGTH / 2);
		context.closePath();
		context.fillStyle = MAP_BLIP_FILL_COLORS.controlled;
		context.fill();
		context.lineWidth = 1;
		context.strokeStyle = "rgba(0, 0, 0, 0.7)";
		context.stroke();
		context.restore();
	}

	/** Convert CSS pointer coordinates into canvas pixels before marker hit testing. */
	function showBlipTooltip(event: PointerEvent): void {
		blipHoverPoint = {
			clientX: event.clientX,
			clientY: event.clientY,
		};
		reconcileBlipTooltip();
	}

	/** Keep hover output valid as either the pointer or presentation-rate markers move. */
	function reconcileBlipTooltip(): void {
		const hover = blipHoverPoint;
		if (!hover) {
			if (tooltip !== null) tooltip = null;
			return;
		}
		const canvas = overlayCanvas;
		const canvasBounds = canvas?.getBoundingClientRect();
		const frameBounds = canvas
			?.closest(".minimap-frame")
			?.getBoundingClientRect();
		if (
			!canvas ||
			!canvasBounds ||
			!frameBounds ||
			canvasBounds.width <= 0 ||
			canvasBounds.height <= 0
		) {
			if (tooltip !== null) tooltip = null;
			return;
		}
		const canvasX =
			((hover.clientX - canvasBounds.left) * canvas.width) / canvasBounds.width;
		const canvasY =
			((hover.clientY - canvasBounds.top) * canvas.height) /
			canvasBounds.height;
		const names = [
			...new Set(
				blipHitTargets
					.filter(
						(target) =>
							Math.hypot(target.x - canvasX, target.y - canvasY) <=
							BLIP_HIT_RADIUS,
					)
					.map((target) => target.name),
			),
		];
		if (names.length === 0) {
			if (tooltip !== null) tooltip = null;
			return;
		}
		const left = hover.clientX - frameBounds.left;
		const top = hover.clientY - frameBounds.top;
		if (
			tooltip?.left === left &&
			tooltip.top === top &&
			sameNames(tooltip.names, names)
		) {
			return;
		}
		tooltip = {
			left,
			names,
			top,
		};
	}

	function clearBlipTooltip(): void {
		blipHoverPoint = null;
		reconcileBlipTooltip();
	}

	function sameNames(
		left: readonly string[],
		right: readonly string[],
	): boolean {
		return (
			left.length === right.length &&
			left.every((name, index) => name === right[index])
		);
	}

	/**
	 * Update compass chrome from the same snapshot as the canvases, outside Svelte reactivity.
	 *
	 * The map always faces the subject up, so north turns opposite its bearing. The camera cone is
	 * relative to that bearing and therefore points straight up whenever camera and subject agree.
	 */
	function drawChrome(
		frame: MinimapFrame,
		overlay: ProjectedMapView | null,
	): void {
		const anchor = frame.subject?.anchor ?? null;
		const subjectClip =
			overlay === null || anchor === null
				? null
				: projectMapWorldPoint(
						overlay.worldToClip,
						overlay.view,
						anchor.worldX,
						anchor.worldZ,
					);
		const subjectX = (subjectClip?.[0] ?? 0) * DISC_RADIUS;
		const subjectY = -(subjectClip?.[1] ?? 0) * DISC_RADIUS;
		const subjectInsideDisc =
			subjectClip !== null && Math.hypot(subjectClip[0], subjectClip[1]) <= 1;
		if (coneElement) {
			coneElement.style.display = subjectInsideDisc ? "" : "none";
			coneElement.setAttribute("d", conePath(frame.cameraFovRadians));
			const rotation = anchor
				? ((frame.cameraHeadingRadians - anchor.headingRadians) * 180) / Math.PI
				: 0;
			coneElement.setAttribute(
				"transform",
				`translate(${subjectX} ${subjectY}) rotate(${rotation})`,
			);
		}
		if (northGroup) {
			const rotation = anchor ? (-anchor.headingRadians * 180) / Math.PI : 0;
			northGroup.setAttribute("transform", `rotate(${rotation})`);
		}
		if (freeAnchorElement) {
			freeAnchorElement.style.display =
				frame.subject?.kind === "free-camera" ? "" : "none";
			freeAnchorElement.setAttribute("cx", String(subjectX));
			freeAnchorElement.setAttribute("cy", String(subjectY));
		}
		if (coordinatesElement) {
			coordinatesElement.textContent = overlay
				? formatWorldMapCoordinates({
						x: overlay.view.center.worldX,
						z: overlay.view.center.worldZ,
					})
				: "";
		}
	}

	function beginMinimapPan(event: PointerEvent): void {
		if (event.button !== 0) return;
		const frame = readFrame();
		const parameters = view(frame);
		const subject = frame.subject;
		const canvas = overlayCanvas;
		const bounds = canvas?.getBoundingClientRect();
		if (
			parameters === null ||
			subject === null ||
			canvas === null ||
			bounds === undefined ||
			bounds.width <= 0 ||
			bounds.height <= 0
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		clearBlipTooltip();
		minimapPanGesture = {
			canvasHeight: bounds.height,
			canvasWidth: bounds.width,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			subject,
			view: parameters,
		};
		canvas.setPointerCapture(event.pointerId);
	}

	function moveMapPointer(event: PointerEvent): void {
		const gesture = minimapPanGesture;
		if (gesture === null || gesture.pointerId !== event.pointerId) {
			showBlipTooltip(event);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const deltaX = event.clientX - gesture.startClientX;
		const deltaY = event.clientY - gesture.startClientY;
		if (Math.hypot(deltaX, deltaY) <= MINIMAP_PAN_DRAG_THRESHOLD_PIXELS) return;
		replaceMinimapPanState(
			detachMinimapPan(
				mapCenterAfterCanvasDrag(
					gesture.view,
					gesture.canvasWidth,
					gesture.canvasHeight,
					deltaX,
					deltaY,
				),
				gesture.subject,
			),
		);
	}

	function endMinimapPan(event: PointerEvent): void {
		const gesture = minimapPanGesture;
		if (gesture?.pointerId !== event.pointerId) return;
		const dragged =
			Math.hypot(
				event.clientX - gesture.startClientX,
				event.clientY - gesture.startClientY,
			) > MINIMAP_PAN_DRAG_THRESHOLD_PIXELS;
		if (dragged) moveMapPointer(event);
		minimapPanGesture = null;
		const canvas = overlayCanvas;
		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}
		if (!dragged) onSelectEntity(closestBlipGuid(event.clientX, event.clientY));
	}

	function cancelMinimapPan(): void {
		const gesture = minimapPanGesture;
		minimapPanGesture = null;
		if (gesture && overlayCanvas?.hasPointerCapture(gesture.pointerId))
			overlayCanvas.releasePointerCapture(gesture.pointerId);
	}

	function cancelMinimapPointer(event: PointerEvent): void {
		if (minimapPanGesture?.pointerId === event.pointerId) cancelMinimapPan();
	}

	function closestBlipGuid(clientX: number, clientY: number): number | null {
		const canvas = overlayCanvas;
		if (canvas === null) return null;
		const bounds = canvas.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return null;
		const x = ((clientX - bounds.left) * canvas.width) / bounds.width;
		const y = ((clientY - bounds.top) * canvas.height) / bounds.height;
		return closestMinimapSelectionGuid(blipHitTargets, x, y, BLIP_HIT_RADIUS);
	}

	function replaceMinimapPanState(state: MinimapPanState): void {
		if (minimapPanState === state) return;
		minimapPanState = state;
		const detached = state.kind === "detached";
		if (minimapDetached !== detached) minimapDetached = detached;
	}

	function resetMinimapPan(event: MouseEvent): void {
		event.stopPropagation();
		replaceMinimapPanState(ANCHORED_MINIMAP_PAN_STATE);
	}

	function beginDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const { left, top } = viewState;
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				onStateChange({
					...viewState,
					left: left + moved.clientX - startX,
					top: top + moved.clientY - startY,
				});
			},
		);
	}

	function beginResize(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const startSize = viewState.size;
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				// Square by construction, so the larger drag axis wins.
				const delta = Math.max(moved.clientX - startX, moved.clientY - startY);
				onStateChange({
					...viewState,
					size: Math.max(MINIMAP_MINIMUM_SIZE, Math.round(startSize + delta)),
				});
			},
		);
	}

	function zoom(event: WheelEvent): void {
		event.preventDefault();
		// Multiplicative so each notch covers the same proportion at every scale.
		const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
		const frame = readFrame();
		const anchor = frame.subject?.anchor ?? null;
		const environment = mapEnvironment(anchor);
		onStateChange({
			...viewState,
			viewDiameters: {
				...viewState.viewDiameters,
				[environment]: clampMapViewDiameter(
					minimapViewDiameter(viewState, anchor) * factor,
				),
			},
		});
	}
</script>

<svelte:window onblur={cancelMinimapPan} />

<section
	class="minimap"
	style:left={`${viewState.left}px`}
	style:top={`${viewState.top}px`}
	style:width={`${viewState.size}px`}
	style:height={`${viewState.size}px`}
	style:--map-rim={`${RIM_FRACTION * 100}%`}
	aria-label="Minimap"
>
	<!--
		The round frame owns wheel zoom, while its two dedicated studs own moving and resizing. The
		square corners around the compass stay transparent to the scene behind.
	-->
	<div
		class="minimap-frame"
		role="toolbar"
		aria-label="Minimap frame"
		tabindex="-1"
		onwheel={zoom}
	>
		<div class="minimap-disc">
			<canvas bind:this={mapCanvas} class="minimap-canvas minimap-map-canvas"
			></canvas>
			<canvas
				bind:this={overlayCanvas}
				class="minimap-canvas minimap-overlay-canvas"
				onpointerdown={beginMinimapPan}
				onpointermove={moveMapPointer}
				onpointerup={endMinimapPan}
				onpointercancel={cancelMinimapPointer}
				onlostpointercapture={cancelMinimapPointer}
				onpointerleave={clearBlipTooltip}
			></canvas>
		</div>
		<svg class="minimap-compass" viewBox="-100 -100 200 200" aria-hidden="true">
			<!-- The camera's own cone, attached to the subject even when the viewed centre is panned. -->
			<defs>
				<clipPath id="minimap-disc-clip">
					<circle cx="0" cy="0" r={DISC_RADIUS} />
				</clipPath>
			</defs>
			<!-- The fixed parent clips the translated cone; clipping the path would move its mask too. -->
			<g clip-path="url(#minimap-disc-clip)">
				<path bind:this={coneElement} class="minimap-cone" />
			</g>
			<g bind:this={northGroup}>
				{#each [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const as [label, degrees]}
					<text
						class="minimap-cardinal"
						class:minimap-cardinal-north={degrees === 0}
						x="0"
						y={-CARDINAL_RADIUS}
						transform={`rotate(${degrees})`}>{label}</text
					>
				{/each}
			</g>
			<!-- Free-camera explorer mode has an anchor but no controlled character. -->
			<circle
				bind:this={freeAnchorElement}
				class="minimap-free-anchor"
				clip-path="url(#minimap-disc-clip)"
				cx="0"
				cy="0"
				r="3.5"
			/>
		</svg>
		{#if minimapDetached}
			<button
				type="button"
				class="minimap-reset"
				onclick={resetMinimapPan}
				aria-label="Re-anchor minimap"
				title="Re-anchor minimap"
			>
				<svg class="minimap-handle-icon" viewBox="0 0 12 12" aria-hidden="true">
					<path d="M 9.8 5 A 4 4 0 1 0 10 7 M 9.8 5 V 1.8 M 9.8 5 H 6.6" />
				</svg>
			</button>
		{/if}
		{#if tooltip}
			<div
				class="minimap-tooltip"
				role="tooltip"
				style:left={`${tooltip.left}px`}
				style:top={`${tooltip.top}px`}
			>
				{tooltip.names.join(", ")}
			</div>
		{/if}
		{#if editable}
			<button
				type="button"
				class="minimap-move"
				onpointerdown={beginDrag}
				aria-label="Move minimap"
			>
				<svg class="minimap-handle-icon" viewBox="0 0 12 12" aria-hidden="true">
					<path
						d="M 6 1 V 11 M 1 6 H 11 M 6 1 L 4.5 2.5 M 6 1 L 7.5 2.5 M 6 11 L 4.5 9.5 M 6 11 L 7.5 9.5 M 1 6 L 2.5 4.5 M 1 6 L 2.5 7.5 M 11 6 L 9.5 4.5 M 11 6 L 9.5 7.5"
					/>
				</svg>
			</button>
			<button
				type="button"
				class="minimap-resize"
				onpointerdown={beginResize}
				aria-label="Resize minimap"
			>
				<svg class="minimap-handle-icon" viewBox="0 0 12 12" aria-hidden="true">
					<path d="M 2 10 L 10 2 M 2 10 V 7 M 2 10 H 5 M 10 2 H 7 M 10 2 V 5" />
				</svg>
			</button>
		{/if}
	</div>
	<span bind:this={coordinatesElement} class="minimap-coordinates"></span>
</section>

<style>
	.minimap {
		position: absolute;
		/* Only the frame and its handle take input; the corners belong to the scene behind. */
		pointer-events: none;
		user-select: none;
	}

	.minimap-frame {
		position: relative;
		width: 100%;
		height: 100%;
		border: var(--ac-border);
		border-radius: 50%;
		background:
			radial-gradient(
				circle at 32% 16%,
				rgb(245 203 95 / 0.3),
				transparent 58%
			),
			linear-gradient(180deg, rgb(96 60 22 / 0.94), rgb(48 34 18 / 0.98));
		box-shadow:
			inset 0 1px 0 rgb(245 203 95 / 0.5),
			inset 0 -1px 0 rgb(97 68 23 / 0.78),
			0 8px 24px rgb(0 0 0 / 0.44);
		pointer-events: auto;
	}

	.minimap-disc {
		position: absolute;
		inset: var(--map-rim);
		overflow: hidden;
		border-radius: 50%;
		background: var(--ac-panel-deep);
		cursor: grab;
		touch-action: none;
	}

	.minimap-disc:active {
		cursor: grabbing;
	}

	/* Seats the map inside the bezel: a gold lip at the rim and a shadow cast over the edge. */
	.minimap-disc::after {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50%;
		box-shadow:
			inset 0 0 0 1px rgb(97 68 23 / 0.9),
			inset 0 3px 10px rgb(0 0 0 / 0.55);
		pointer-events: none;
	}

	.minimap-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.minimap-compass {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* Cardinal letters are drawn past the viewBox on purpose; see CARDINAL_RADIUS. */
		overflow: visible;
		pointer-events: none;
	}

	.minimap-cone {
		fill: rgb(230 230 245 / 0.12);
	}

	.minimap-cardinal {
		fill: var(--ac-ink);
		font-family: var(--ac-font-serif);
		font-size: 18px;
		font-weight: bold;
		text-anchor: middle;
		dominant-baseline: central;
		/* Outline first, then the letter over it, so the engraving survives the bezel gradient. */
		paint-order: stroke;
		stroke: rgb(0 0 0 / 0.85);
		stroke-width: 2.2px;
		filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.9));
	}

	.minimap-cardinal-north {
		fill: var(--ac-gold-bright);
	}

	.minimap-free-anchor {
		fill: rgb(150 220 150 / 0.95);
		stroke: rgb(0 0 0 / 0.7);
		stroke-width: 1;
	}

	.minimap-tooltip {
		position: absolute;
		z-index: 2;
		max-width: 180px;
		padding: 3px 6px;
		border: var(--ac-border);
		border-radius: 3px;
		color: var(--ac-ink);
		font-size: 12px;
		line-height: 1.25;
		text-align: center;
		white-space: normal;
		background: rgb(24 18 13 / 0.96);
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.55);
		pointer-events: none;
		transform: translate(-50%, calc(-100% - 8px));
	}

	.minimap-move,
	.minimap-resize,
	.minimap-reset {
		position: absolute;
		width: 20px;
		height: 20px;
		min-height: 0;
		padding: 0;
		overflow: hidden;
		border: var(--ac-border);
		border-radius: 50%;
		color: rgb(245 203 95 / 0.88);
		background: linear-gradient(
			180deg,
			rgb(84 52 19 / 0.98),
			rgb(30 22 15 / 0.98)
		);
		box-shadow:
			inset 0 1px 0 rgb(245 203 95 / 0.55),
			0 2px 5px rgb(0 0 0 / 0.55);
		transform: translate(-50%, -50%);
	}

	.minimap-move {
		/* Opposite the resize stud, centred on the rim at 225 degrees. */
		top: 14.645%;
		left: 14.645%;
		cursor: grab;
	}

	.minimap-move:active {
		cursor: grabbing;
	}

	.minimap-resize {
		/* Centred on the rim at 45 degrees: 50% + (50% / sqrt 2). */
		top: 85.355%;
		left: 85.355%;
		cursor: nwse-resize;
	}

	.minimap-reset {
		/* Remaining diagonal rim position, clear of the layout handles and cardinal labels. */
		top: 14.645%;
		left: 85.355%;
		cursor: pointer;
	}

	.minimap-handle-icon {
		position: absolute;
		inset: 3px;
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentcolor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.35;
		pointer-events: none;
	}

	.minimap-coordinates {
		position: absolute;
		top: 100%;
		left: 50%;
		margin-top: 10px;
		padding: 4px 10px;
		border-radius: 6px;
		color: var(--ac-ink);
		font-family: var(--ac-font-ui);
		font-size: 0.86rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
		white-space: nowrap;
		text-shadow: 1px 1px 0 #000;
		background: rgb(7 6 5 / 0.55);
		backdrop-filter: blur(6px);
		transform: translateX(-50%);
	}
</style>
