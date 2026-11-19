/** Copy completed user selections without giving document mutations clipboard ownership. */
export function copyTextSelection(
	element: HTMLElement,
	onError: (message: string) => void,
	options?: { readonly selectAllWithin?: boolean },
): { destroy: () => void; isSelecting: () => boolean } {
	const document = element.ownerDocument;
	const window = document.defaultView;
	if (window === null) throw new Error("Text selection requires a window.");
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
	/** Keep live text stable while the user is carving out or reading a selection. */
	const isSelecting = () => {
		if (pointer !== null || selectingByKeyboard) return true;
		const selection = document.getSelection();
		return (
			selection !== null &&
			!selection.isCollapsed &&
			element.contains(selection.anchorNode) &&
			element.contains(selection.focusNode)
		);
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
				`Selection copy failed: ${error instanceof Error ? error.message : String(error)}`,
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
		const selectAll =
			(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
		const scopedSelectAll = selectAll && options?.selectAllWithin;
		if (scopedSelectAll) event.preventDefault();
		const selects =
			selectAll ||
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
				].includes(event.key));
		if (!selects || selectingByKeyboard) return;
		selectingByKeyboard = true;
		before = snapshot();
		if (scopedSelectAll) document.getSelection()?.selectAllChildren(element);
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
		isSelecting,
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
