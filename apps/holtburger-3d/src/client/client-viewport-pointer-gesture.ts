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

/** Immutable displacement classification; the mouse owner handles DOM lifetime. */
export interface ClientViewportPointerGesture {
	readonly startX: number;
	readonly startY: number;
	readonly lastX: number;
	readonly lastY: number;
	readonly dragging: boolean;
}

export interface ClientViewportPointerAdvance {
	readonly gesture: ClientViewportPointerGesture;
	/** Null while the gesture remains a click candidate. */
	readonly dragDelta: { readonly x: number; readonly y: number } | null;
}

export function beginClientViewportPointerGesture(
	x: number,
	y: number,
): ClientViewportPointerGesture {
	return {
		dragging: false,
		lastX: x,
		lastY: y,
		startX: x,
		startY: y,
	};
}

/** Advance once; threshold crossing emits the complete start-to-current delta exactly once. */
export function advanceClientViewportPointerGesture(
	gesture: ClientViewportPointerGesture,
	x: number,
	y: number,
): ClientViewportPointerAdvance {
	const totalX = x - gesture.startX;
	const totalY = y - gesture.startY;
	const dragging =
		gesture.dragging ||
		Math.hypot(totalX, totalY) > CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS;
	const deltaX = gesture.dragging ? x - gesture.lastX : totalX;
	const deltaY = gesture.dragging ? y - gesture.lastY : totalY;
	const dragDelta =
		dragging && (deltaX !== 0 || deltaY !== 0)
			? { x: deltaX, y: deltaY }
			: null;
	return {
		gesture: { ...gesture, dragging, lastX: x, lastY: y },
		dragDelta,
	};
}
