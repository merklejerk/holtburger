/** Shared outside-click cancellation for native modals and panel-scoped dialog overlays.
 * Both the press and click must start/end on the backdrop so dragging out of a control is safe.
 * Feature callbacks retain ownership of cancellation and any in-flight submission restrictions.
 */
export function dismissDialogOnBackdrop(
	element: HTMLElement,
	onDismiss: () => void,
): { update: (next: () => void) => void; destroy: () => void } {
	let pressedBackdrop = false;
	const isBackdrop = (event: MouseEvent): boolean => {
		if (!(element instanceof HTMLDialogElement))
			return event.target === element;
		const bounds = element.getBoundingClientRect();
		return (
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom
		);
	};
	const press = (event: PointerEvent): void => {
		pressedBackdrop = isBackdrop(event);
	};
	const cancel = (): void => {
		pressedBackdrop = false;
	};
	const click = (event: MouseEvent): void => {
		const dismiss = pressedBackdrop && isBackdrop(event);
		pressedBackdrop = false;
		if (dismiss) onDismiss();
	};
	element.addEventListener("pointerdown", press);
	element.addEventListener("pointercancel", cancel);
	element.addEventListener("click", click);
	return {
		update: (next) => {
			onDismiss = next;
		},
		destroy: () => {
			element.removeEventListener("pointerdown", press);
			element.removeEventListener("pointercancel", cancel);
			element.removeEventListener("click", click);
		},
	};
}
