/**
 * Track one window-level pointer gesture until that pointer is released or cancelled.
 *
 * The event target is injected so gesture ownership stays explicit and the lifecycle can be
 * exercised without relying on the ambient browser window.
 */
export function trackPointerGesture(
	target: Window,
	pointerId: number,
	update: (event: PointerEvent) => void,
): () => void {
	let active = true;
	function cancel(): void {
		if (!active) return;
		active = false;
		target.removeEventListener("pointermove", move);
		target.removeEventListener("pointerup", end);
		target.removeEventListener("pointercancel", end);
	}
	function move(event: PointerEvent): void {
		if (event.pointerId === pointerId) update(event);
	}
	function end(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return;
		cancel();
	}
	target.addEventListener("pointermove", move);
	target.addEventListener("pointerup", end);
	target.addEventListener("pointercancel", end);
	return cancel;
}
