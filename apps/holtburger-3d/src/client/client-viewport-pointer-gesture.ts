/** Pointer displacement required to commit a click candidate to dragging. */
export const CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS = 3;

/** Camera operations consumed by viewport pointer gestures. */
export interface ClientViewportCameraController {
	/** Explicit sticky rear-follow used by character steering. */
	readonly followRear: (nowMs: number) => void;
	/** Vertical camera adjustment that preserves character-owned steering yaw. */
	readonly pitch: (deltaY: number) => void;
	readonly orbit: (deltaX: number, deltaY: number, nowMs: number) => void;
	readonly zoom: (displacement: number) => void;
}

/** Movement accumulated before a drag commits; button coordinates never define displacement. */
export type ClientViewportPointerGesture =
	| {
			readonly kind: "pending";
			/** Net horizontal movement since the gesture began. */
			readonly deltaX: number;
			/** Net vertical movement since the gesture began. */
			readonly deltaY: number;
	  }
	| { readonly kind: "dragging" };

export interface ClientViewportPointerAdvance {
	readonly gesture: ClientViewportPointerGesture;
	/** Null before dragging commits or when the movement sample has no displacement. */
	readonly dragDelta: { readonly x: number; readonly y: number } | null;
}

export function beginClientViewportPointerGesture(): ClientViewportPointerGesture {
	return { kind: "pending", deltaX: 0, deltaY: 0 };
}

/** Advance once; threshold crossing emits the complete start-to-current delta exactly once. */
export function advanceClientViewportPointerGesture(
	gesture: ClientViewportPointerGesture,
	movementX: number,
	movementY: number,
): ClientViewportPointerAdvance {
	const deltaX =
		gesture.kind === "pending" ? gesture.deltaX + movementX : movementX;
	const deltaY =
		gesture.kind === "pending" ? gesture.deltaY + movementY : movementY;
	if (
		gesture.kind === "pending" &&
		Math.hypot(deltaX, deltaY) <= CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS
	) {
		return { gesture: { kind: "pending", deltaX, deltaY }, dragDelta: null };
	}
	const dragDelta =
		deltaX !== 0 || deltaY !== 0 ? { x: deltaX, y: deltaY } : null;
	return {
		gesture: { kind: "dragging" },
		dragDelta,
	};
}
