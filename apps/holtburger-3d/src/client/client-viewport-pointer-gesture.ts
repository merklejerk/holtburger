/** Pointer displacement required to commit a primary-button gesture to camera orbit. */
const VIEWPORT_ORBIT_DRAG_THRESHOLD_PIXELS = 3;

/** Camera operations consumed by viewport pointer gestures. */
export interface ClientViewportCameraController {
	readonly orbit: (deltaX: number, deltaY: number, nowMs: number) => void;
	readonly zoom: (displacement: number) => void;
}

/** Immutable viewport gesture state; the component owns capture and cancellation. */
export interface ClientViewportPointerGesture {
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	readonly lastX: number;
	readonly lastY: number;
	readonly dragging: boolean;
}

export interface ClientViewportPointerAdvance {
	readonly gesture: ClientViewportPointerGesture;
	/** Null while the gesture remains a click candidate. */
	readonly orbitDelta: { readonly x: number; readonly y: number } | null;
}

export function beginClientViewportPointerGesture(
	pointerId: number,
	x: number,
	y: number,
): ClientViewportPointerGesture {
	return {
		dragging: false,
		lastX: x,
		lastY: y,
		pointerId,
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
		Math.hypot(totalX, totalY) > VIEWPORT_ORBIT_DRAG_THRESHOLD_PIXELS;
	const deltaX = gesture.dragging ? x - gesture.lastX : totalX;
	const deltaY = gesture.dragging ? y - gesture.lastY : totalY;
	const orbitDelta =
		dragging && (deltaX !== 0 || deltaY !== 0)
			? { x: deltaX, y: deltaY }
			: null;
	return {
		gesture: { ...gesture, dragging, lastX: x, lastY: y },
		orbitDelta,
	};
}
