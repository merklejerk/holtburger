import type { SceneVec3 } from "../../../assets/ac-frame";

/** World-aligned AC axis represented by one transform gizmo handle (+X East, +Y North, +Z Up). */
export type TransformGizmoAxis = "x" | "y" | "z";

/** One interactive translate shaft/cone or rotate ring handle on the combined 6-DOF gizmo. */
export interface TransformGizmoHandle {
	readonly kind: "translate" | "rotate";
	readonly axis: TransformGizmoAxis;
}

/**
 * Shared normalized gizmo proportions consumed by both the WebGL2 pass and Explorer ray picking
 * so rendered handle geometry and hit targets never drift apart.
 */
export const TRANSFORM_GIZMO_GEOMETRY = {
	centerRadius: 0.08,
	shaftStart: 0.14,
	shaftEnd: 1.15,
	shaftRadius: 0.022,
	coneStart: 1.15,
	coneEnd: 1.38,
	coneRadius: 0.075,
	ringRadius: 0.62,
	ringTubeRadius: 0.018,
	ringSegments: 48,
} as const;

/** Render-only Explorer gizmo visual frame; Client always supplies `null`. */
export interface TransformGizmoVisual {
	/** World-space render position of the gizmo origin. */
	readonly position: SceneVec3;
	/** Camera-distance-derived uniform world scale in metres. */
	readonly scale: number;
	/** Currently hovered handle, or null when idle. */
	readonly hovered: TransformGizmoHandle | null;
	/** Currently dragged handle, or null when not dragging. */
	readonly active: TransformGizmoHandle | null;
}

/** Value-equality check for two optional gizmo handles. */
export function sameTransformGizmoHandle(
	a: TransformGizmoHandle | null,
	b: TransformGizmoHandle | null,
): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	return a.kind === b.kind && a.axis === b.axis;
}
