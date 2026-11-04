/** DOM operations shared by isolated model inspection and the pregame scene surface. */
type ModelRotationSurface = Pick<
	HTMLElement,
	| "setAttribute"
	| "setPointerCapture"
	| "hasPointerCapture"
	| "releasePointerCapture"
	| "focus"
	| "addEventListener"
	| "removeEventListener"
>;

/** Mount-owned input; heading and pointer capture never enter Svelte's reactive graph. */
export function mountModelRotation(
	surface: ModelRotationSurface,
	options: {
		readonly initialYawRadians: number;
		readonly yawRadiansPerPixel: number;
		readonly keyboardYawStepRadians: number;
		readonly keyboardNavigation: boolean;
		readonly onHeading: () => void;
	},
) {
	let heading = options.initialYawRadians;
	let pointer: { readonly id: number; x: number } | null = null;
	const publishAria = () => {
		const degrees = modelHeadingDegrees(heading);
		surface.setAttribute("aria-valuenow", String(degrees));
		surface.setAttribute(
			"aria-valuetext",
			`${degrees} degrees horizontal rotation`,
		);
	};
	const cancelPointer = () => {
		const id = pointer?.id;
		pointer = null;
		if (id !== undefined && surface.hasPointerCapture(id))
			surface.releasePointerCapture(id);
	};
	const down = (event: PointerEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (options.keyboardNavigation) surface.focus();
		surface.setPointerCapture(event.pointerId);
		pointer = { id: event.pointerId, x: event.clientX };
	};
	const move = (event: PointerEvent) => {
		if (pointer?.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		heading += (event.clientX - pointer.x) * options.yawRadiansPerPixel;
		pointer.x = event.clientX;
		publishAria();
		options.onHeading();
	};
	const finish = (event: PointerEvent) => {
		if (pointer?.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		cancelPointer();
	};
	const lost = () => {
		pointer = null;
	};
	const keydown = (event: KeyboardEvent) => {
		if (!options.keyboardNavigation) return;
		if (event.key === "ArrowLeft") heading -= options.keyboardYawStepRadians;
		else if (event.key === "ArrowRight")
			heading += options.keyboardYawStepRadians;
		else return;
		event.preventDefault();
		event.stopPropagation();
		publishAria();
		options.onHeading();
	};
	surface.addEventListener("pointerdown", down);
	surface.addEventListener("pointermove", move);
	surface.addEventListener("pointerup", finish);
	surface.addEventListener("pointercancel", finish);
	surface.addEventListener("lostpointercapture", lost);
	surface.addEventListener("blur", cancelPointer);
	surface.addEventListener("keydown", keydown);
	publishAria();
	return {
		heading: () => heading,
		cancelPointer,
		destroy: () => {
			cancelPointer();
			surface.removeEventListener("pointerdown", down);
			surface.removeEventListener("pointermove", move);
			surface.removeEventListener("pointerup", finish);
			surface.removeEventListener("pointercancel", finish);
			surface.removeEventListener("lostpointercapture", lost);
			surface.removeEventListener("blur", cancelPointer);
			surface.removeEventListener("keydown", keydown);
		},
	};
}

/** Accessible horizontal angle wraps without changing the continuous drag heading. */
export function modelHeadingDegrees(radians: number): number {
	const degrees = (radians * 180) / Math.PI;
	return Math.round(((((degrees + 180) % 360) + 360) % 360) - 180);
}
