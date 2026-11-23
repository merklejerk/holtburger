import {
	sameTransformGizmoHandle,
	type TransformGizmoHandle,
	type TransformGizmoVisual,
} from "../../lib/game/renderer/overlays/transform-gizmo-contract";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type { PresentedSelectionRay } from "../../lib/game/selection/entity-selection-intersection";
import { samplePresentedCameraRay } from "../../lib/game/selection/presented-camera-ray";
import type { ExplorerWorldPose } from "../entities/entity-commands";
import {
	beginGizmoDrag,
	computeGizmoScale,
	pickTransformGizmoHandle,
	solveGizmoDragPose,
	worldPoseToSceneVec3,
	type GizmoCanvasBounds,
	type GizmoDragState,
} from "./transform-gizmo-math";

/** Live editable Explorer entity currently eligible for a 3D transform gizmo. */
export interface TransformGizmoTarget {
	readonly guid: number;
	readonly generation: number;
	readonly pose: ExplorerWorldPose;
}

export type TransformGizmoCursor = "grab" | "grabbing" | null;

export interface ExplorerTransformGizmoControllerDependencies {
	/** Returns the currently editable target, or null when hidden, empty, attached, or possessed. */
	readonly readTarget: () => TransformGizmoTarget | null;
	/** Exact camera/extent pair most recently presented to the renderer. */
	readonly readPrimaryView: () => PrimaryCameraView | null;
	/** Viewport canvas used to resolve client bounds and camera rays. */
	readonly readCanvas: () => HTMLCanvasElement | null;
	/** Publishes the current render-only gizmo visual to the shared presentation runtime. */
	readonly setVisual: (visual: TransformGizmoVisual | null) => void;
	/** Emits each solved AC pose during an active drag for single-flight host commit. */
	readonly onTransformPose: (
		guid: number,
		generation: number,
		pose: ExplorerWorldPose,
	) => void;
	/** Cancels an active drag and reverts the entity to its pre-drag pose. */
	readonly onCancelTransform: (
		guid: number,
		generation: number,
		revertPose: ExplorerWorldPose,
	) => void;
	/** Optional canvas cursor hint for hovered/dragged gizmo handles. */
	readonly onCursorChange?: (cursor: TransformGizmoCursor) => void;
	/** Injectable ray sampler for deterministic unit tests; defaults to `samplePresentedCameraRay`. */
	readonly sampleRay?: (
		view: PrimaryCameraView,
		canvas: HTMLCanvasElement,
		clientX: number,
		clientY: number,
	) => PresentedSelectionRay | null;
	/** Injectable canvas bounds reader for deterministic unit tests. */
	readonly readCanvasBounds?: (canvas: HTMLCanvasElement) => GizmoCanvasBounds;
}

interface ActiveGizmoDrag {
	readonly guid: number;
	readonly generation: number;
	readonly state: GizmoDragState;
	previewPose: ExplorerWorldPose;
}

interface SettledGizmoPreview {
	readonly guid: number;
	readonly generation: number;
	readonly baselinePose: ExplorerWorldPose;
	readonly previewPose: ExplorerWorldPose;
}

interface PublishedVisualCache {
	readonly landblockId: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly camX: number;
	readonly camY: number;
	readonly camZ: number;
	readonly fov: number;
	readonly hovered: TransformGizmoHandle | null;
	readonly active: TransformGizmoHandle | null;
}

/**
 * Owns Explorer transform gizmo hover, drag lifecycle, Escape cancellation, and per-frame
 * render visual synchronization outside Svelte reactive state.
 */
export class ExplorerTransformGizmoController {
	readonly #deps: ExplorerTransformGizmoControllerDependencies;
	readonly #sampleRay: NonNullable<
		ExplorerTransformGizmoControllerDependencies["sampleRay"]
	>;
	readonly #readCanvasBounds: NonNullable<
		ExplorerTransformGizmoControllerDependencies["readCanvasBounds"]
	>;
	#hovered: TransformGizmoHandle | null = null;
	#drag: ActiveGizmoDrag | null = null;
	#settledPreview: SettledGizmoPreview | null = null;
	#cursor: TransformGizmoCursor = null;
	#lastPublished: PublishedVisualCache | null = null;

	constructor(deps: ExplorerTransformGizmoControllerDependencies) {
		this.#deps = deps;
		this.#sampleRay =
			deps.sampleRay ??
			((view, canvas, clientX, clientY) =>
				samplePresentedCameraRay(view, canvas, clientX, clientY)?.refinement ??
				null);
		this.#readCanvasBounds =
			deps.readCanvasBounds ??
			((canvas) => {
				const rect = canvas.getBoundingClientRect();
				return {
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height,
				};
			});
	}

	isDragging(): boolean {
		return this.#drag !== null;
	}

	/** Update hovered handle from unlocked viewport pointer motion. */
	handlePointerHover(clientX: number, clientY: number): void {
		if (this.#drag !== null) return;
		const resolved = this.#resolvePickContext();
		if (resolved === null) {
			this.#setHovered(null);
			return;
		}
		const handle = pickTransformGizmoHandle(
			resolved.view,
			resolved.bounds,
			resolved.origin,
			resolved.scale,
			clientX,
			clientY,
		);
		this.#setHovered(handle);
	}

	/** Clear hover state when pointer leaves the canvas or enters a HUD overlay. */
	clearHover(): void {
		if (this.#drag !== null) return;
		this.#setHovered(null);
	}

	/** Attempt to claim a primary mouse-down on a gizmo handle; returns true when claimed. */
	tryBeginDrag(clientX: number, clientY: number): boolean {
		const resolved = this.#resolvePickContext();
		if (resolved === null) return false;
		const handle = pickTransformGizmoHandle(
			resolved.view,
			resolved.bounds,
			resolved.origin,
			resolved.scale,
			clientX,
			clientY,
		);
		if (handle === null) return false;
		const ray = this.#sampleRay(
			resolved.view,
			resolved.canvas,
			clientX,
			clientY,
		);
		if (ray === null) return false;
		const state = beginGizmoDrag(
			handle,
			resolved.pose,
			resolved.origin,
			ray,
			resolved.view,
			resolved.bounds,
			clientX,
			clientY,
			resolved.scale,
		);
		if (state === null) return false;
		this.#settledPreview = null;
		this.#drag = {
			guid: resolved.target.guid,
			generation: resolved.target.generation,
			state,
			previewPose: resolved.pose,
		};
		this.#hovered = handle;
		this.#setCursor("grabbing");
		this.syncVisual();
		return true;
	}

	/** Advance an active gizmo drag on mousemove, applying Shift snap when held. */
	updateDrag(clientX: number, clientY: number, shiftKey: boolean): void {
		const drag = this.#drag;
		if (drag === null) return;
		const target = this.#deps.readTarget();
		const view = this.#deps.readPrimaryView();
		const canvas = this.#deps.readCanvas();
		if (
			target === null ||
			view === null ||
			canvas === null ||
			target.guid !== drag.guid ||
			target.generation !== drag.generation
		) {
			this.#dropStaleDrag();
			return;
		}
		const ray = this.#sampleRay(view, canvas, clientX, clientY);
		if (ray === null) return;
		const nextPose = solveGizmoDragPose(
			drag.state,
			ray,
			clientX,
			clientY,
			shiftKey,
		);
		// Ray miss / behind-camera step holds the current preview pose instead of snapping back.
		if (nextPose === null) return;
		drag.previewPose = nextPose;
		this.#deps.onTransformPose(drag.guid, drag.generation, nextPose);
		this.syncVisual();
	}

	/** End the active drag, committing the latest pose or reverting to the pre-drag pose. */
	endDrag(commit: boolean): void {
		const drag = this.#drag;
		if (drag === null) return;
		this.#drag = null;
		// Clear hover on release so pointer-up away from the handle never leaves a sticky grab cursor.
		this.#hovered = null;
		this.#setCursor(null);
		if (commit) {
			const liveTarget = this.#deps.readTarget();
			if (
				liveTarget !== null &&
				liveTarget.guid === drag.guid &&
				liveTarget.generation === drag.generation &&
				!samePoseCoords(liveTarget.pose, drag.previewPose)
			) {
				// Hold the released preview pose until the final host correction reaches the mirror.
				this.#settledPreview = {
					guid: drag.guid,
					generation: drag.generation,
					baselinePose: liveTarget.pose,
					previewPose: drag.previewPose,
				};
			} else {
				this.#settledPreview = null;
			}
		} else {
			this.#settledPreview = null;
			this.#deps.onCancelTransform(
				drag.guid,
				drag.generation,
				drag.state.startPose,
			);
		}
		this.syncVisual();
	}

	/** Push the latest camera-scaled gizmo visual to the presentation runtime (called every frame). */
	syncVisual(): void {
		const target = this.#deps.readTarget();
		const view = this.#deps.readPrimaryView();
		if (target === null || view === null) {
			if (this.#drag !== null) {
				this.#drag = null;
			}
			this.#settledPreview = null;
			this.#hovered = null;
			this.#setCursor(null);
			if (this.#lastPublished !== null) {
				this.#lastPublished = null;
				this.#deps.setVisual(null);
			}
			return;
		}
		if (
			this.#drag !== null &&
			(this.#drag.guid !== target.guid ||
				this.#drag.generation !== target.generation)
		) {
			this.#drag = null;
			this.#hovered = null;
			this.#setCursor(null);
		}
		const pose = this.#resolveEffectivePose(target);
		const camPos = view.camera.placement.position;
		const active: TransformGizmoHandle | null =
			this.#drag === null
				? null
				: { kind: this.#drag.state.kind, axis: this.#drag.state.axis };
		const prev = this.#lastPublished;
		if (
			prev !== null &&
			prev.landblockId === pose.landblockId &&
			prev.x === pose.coords.x &&
			prev.y === pose.coords.y &&
			prev.z === pose.coords.z &&
			prev.camX === camPos.x &&
			prev.camY === camPos.y &&
			prev.camZ === camPos.z &&
			prev.fov === view.camera.fov &&
			sameTransformGizmoHandle(prev.hovered, this.#hovered) &&
			sameTransformGizmoHandle(prev.active, active)
		) {
			return;
		}
		const origin = worldPoseToSceneVec3(pose);
		const scale = computeGizmoScale(camPos, origin, view.camera.fov);
		this.#lastPublished = {
			landblockId: pose.landblockId,
			x: pose.coords.x,
			y: pose.coords.y,
			z: pose.coords.z,
			camX: camPos.x,
			camY: camPos.y,
			camZ: camPos.z,
			fov: view.camera.fov,
			hovered: this.#hovered,
			active,
		};
		this.#deps.setVisual({
			position: origin,
			scale,
			hovered: this.#hovered,
			active,
		});
	}

	/** Clear active state and hide the rendered gizmo during shutdown or mode teardown. */
	reset(): void {
		this.#drag = null;
		this.#settledPreview = null;
		this.#hovered = null;
		this.#setCursor(null);
		this.#lastPublished = null;
		this.#deps.setVisual(null);
	}

	#resolveEffectivePose(target: TransformGizmoTarget): ExplorerWorldPose {
		if (this.#drag !== null) return this.#drag.previewPose;
		const settled = this.#settledPreview;
		if (settled !== null) {
			if (
				settled.guid !== target.guid ||
				settled.generation !== target.generation ||
				!samePoseCoords(target.pose, settled.baselinePose)
			) {
				this.#settledPreview = null;
				return target.pose;
			}
			return settled.previewPose;
		}
		return target.pose;
	}

	#resolvePickContext() {
		const target = this.#deps.readTarget();
		const view = this.#deps.readPrimaryView();
		const canvas = this.#deps.readCanvas();
		if (target === null || view === null || canvas === null) return null;
		const bounds = this.#readCanvasBounds(canvas);
		if (bounds.width <= 0 || bounds.height <= 0) return null;
		const pose = this.#resolveEffectivePose(target);
		const origin = worldPoseToSceneVec3(pose);
		const scale = computeGizmoScale(
			view.camera.placement.position,
			origin,
			view.camera.fov,
		);
		return { target, pose, view, canvas, bounds, origin, scale };
	}

	#setHovered(next: TransformGizmoHandle | null): void {
		if (sameTransformGizmoHandle(this.#hovered, next)) return;
		this.#hovered = next;
		this.#setCursor(next !== null ? "grab" : null);
		this.syncVisual();
	}

	#setCursor(next: TransformGizmoCursor): void {
		if (this.#cursor === next) return;
		this.#cursor = next;
		this.#deps.onCursorChange?.(next);
	}

	#dropStaleDrag(): void {
		this.#drag = null;
		this.#settledPreview = null;
		this.#hovered = null;
		this.#setCursor(null);
		this.syncVisual();
	}
}

function samePoseCoords(a: ExplorerWorldPose, b: ExplorerWorldPose): boolean {
	return (
		a.landblockId === b.landblockId &&
		a.coords.x === b.coords.x &&
		a.coords.y === b.coords.y &&
		a.coords.z === b.coords.z
	);
}
