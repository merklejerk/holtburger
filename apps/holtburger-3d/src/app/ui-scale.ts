import { trackPointerGesture } from "./pointer-gesture";

/** Cold geometry invalidation; active local gestures cannot retain an obsolete scale. */
export const UI_SCALE_CHANGE_EVENT = "holtburger-ui-scale-change";

/** Apply layout scaling once at a UI boundary; descendants and native top-layer surfaces inherit it. */
export function applyUiScale(element: HTMLElement, initialScale: number) {
	let scale = initialScale;
	element.classList.add("ui-scale-surface");
	const apply = () => {
		element.style.zoom = String(scale);
		element.style.setProperty("--ui-scale", String(scale));
	};
	apply();
	return {
		update(nextScale: number) {
			if (nextScale === scale) return;
			scale = nextScale;
			apply();
			element.dispatchEvent(
				new Event(UI_SCALE_CHANGE_EVENT, { bubbles: true }),
			);
		},
	};
}

/** Effective client preference, or the explicit neutral preference on Explorer/theme roots. */
export function uiScale(element: Element): number {
	const value = Number(
		getComputedStyle(element).getPropertyValue("--ui-scale"),
	);
	if (!Number.isFinite(value) || value <= 0)
		throw new Error("Invalid UI scale at geometry consumer");
	return value;
}

/** Read displayed bounds in local UI units, retaining fractional CSS dimensions. */
export function uiLocalSize(element: Element): {
	width: number;
	height: number;
} {
	const bounds = element.getBoundingClientRect();
	const scale = uiScale(element);
	return { width: bounds.width / scale, height: bounds.height / scale };
}

/** Capture scale while the event's currentTarget still names the geometry owner. */
export function pointerUiScale(event: PointerEvent): number {
	if (!(event.currentTarget instanceof Element))
		throw new Error("UI pointer gesture has no element owner");
	return uiScale(event.currentTarget);
}

/** Track a local geometry gesture, cancelling before any changed scale can commit stale coordinates. */
export function trackUiPointerGesture(
	target: Window,
	pointerId: number,
	update: (event: PointerEvent) => void,
): () => void {
	const stop = trackPointerGesture(target, pointerId, update);
	const cancel = () => {
		stop();
		target.removeEventListener(UI_SCALE_CHANGE_EVENT, cancel);
		target.removeEventListener("pointerup", end);
		target.removeEventListener("pointercancel", end);
	};
	const end = (event: PointerEvent) => {
		if (event.pointerId === pointerId) cancel();
	};
	target.addEventListener(UI_SCALE_CHANGE_EVENT, cancel);
	target.addEventListener("pointerup", end);
	target.addEventListener("pointercancel", end);
	return cancel;
}
