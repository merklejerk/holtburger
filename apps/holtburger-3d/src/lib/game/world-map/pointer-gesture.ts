/** Track one map pan; once crossed, the travel threshold stays crossed. */
export function trackWorldMapGesture(
	target: Window,
	start: PointerEvent,
	thresholdPixels: number,
	pan: (deltaX: number, deltaY: number) => void,
): () => void {
	let active = true;
	let dragged = false;
	function cancel(): void {
		if (!active) return;
		active = false;
		target.removeEventListener("pointermove", move);
		target.removeEventListener("pointerup", release);
		target.removeEventListener("pointercancel", abort);
	}
	function travel(event: PointerEvent): readonly [number, number] {
		const dx = event.clientX - start.clientX;
		const dy = event.clientY - start.clientY;
		if (Math.hypot(dx, dy) > thresholdPixels) dragged = true;
		return [dx, dy];
	}
	function move(event: PointerEvent): void {
		if (event.pointerId !== start.pointerId) return;
		const [dx, dy] = travel(event);
		if (dragged) pan(dx, dy);
	}
	function release(event: PointerEvent): void {
		if (event.pointerId !== start.pointerId) return;
		cancel();
	}
	function abort(event: PointerEvent): void {
		if (event.pointerId === start.pointerId) cancel();
	}
	target.addEventListener("pointermove", move);
	target.addEventListener("pointerup", release);
	target.addEventListener("pointercancel", abort);
	return cancel;
}
