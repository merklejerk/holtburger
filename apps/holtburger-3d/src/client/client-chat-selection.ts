/** Copy completed user selections without giving document mutations clipboard ownership. */
export function copyChatSelection(
	element: HTMLElement,
	onError: (message: string) => void,
): { destroy: () => void } {
	const document = element.ownerDocument;
	const window = document.defaultView;
	if (window === null) throw new Error("Chat selection requires a window.");
	const snapshot = () => {
		const selection = document.getSelection();
		if (selection === null) return null;
		return {
			anchor: selection.anchorNode,
			anchorOffset: selection.anchorOffset,
			focus: selection.focusNode,
			focusOffset: selection.focusOffset,
		};
	};
	let before: ReturnType<typeof snapshot> = null;
	let pointer: number | null = null;
	let selectingByKeyboard = false;
	const copy = async () => {
		const selection = document.getSelection();
		const after = snapshot();
		if (
			selection === null ||
			selection.isCollapsed ||
			after === null ||
			!element.contains(after.anchor) ||
			!element.contains(after.focus) ||
			(before !== null &&
				before.anchor === after.anchor &&
				before.anchorOffset === after.anchorOffset &&
				before.focus === after.focus &&
				before.focusOffset === after.focusOffset)
		)
			return;
		const text = selection.toString();
		if (text.length === 0) return;
		try {
			await window.navigator.clipboard.writeText(text);
		} catch (error: unknown) {
			onError(
				`Chat selection copy failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};
	const pointerdown = (event: PointerEvent) => {
		if (event.button !== 0) return;
		pointer = event.pointerId;
		before = snapshot();
	};
	const pointerup = (event: PointerEvent) => {
		if (pointer !== event.pointerId) return;
		pointer = null;
		void copy();
	};
	const cancel = () => {
		pointer = null;
		selectingByKeyboard = false;
	};
	const keydown = (event: KeyboardEvent) => {
		if (!element.contains(document.activeElement)) return;
		const selects =
			(event.shiftKey &&
				[
					"ArrowLeft",
					"ArrowRight",
					"ArrowUp",
					"ArrowDown",
					"Home",
					"End",
					"PageUp",
					"PageDown",
				].includes(event.key)) ||
			((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a");
		if (!selects || selectingByKeyboard) return;
		selectingByKeyboard = true;
		before = snapshot();
	};
	const keyup = () => {
		if (!selectingByKeyboard) return;
		selectingByKeyboard = false;
		void copy();
	};
	element.addEventListener("pointerdown", pointerdown);
	document.addEventListener("keydown", keydown, true);
	window.addEventListener("keyup", keyup, true);
	window.addEventListener("pointerup", pointerup);
	window.addEventListener("pointercancel", cancel);
	window.addEventListener("blur", cancel);
	return {
		destroy: () => {
			element.removeEventListener("pointerdown", pointerdown);
			document.removeEventListener("keydown", keydown, true);
			window.removeEventListener("keyup", keyup, true);
			window.removeEventListener("pointerup", pointerup);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("blur", cancel);
		},
	};
}
