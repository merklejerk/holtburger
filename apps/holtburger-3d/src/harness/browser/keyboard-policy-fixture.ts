import { ExplorerCameraInputController } from "../../explorer/explorer-camera-input-controller";
import { APP_INPUT } from "../../lib/input/app-input";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import type { ViewportInputGate } from "../../lib/input/viewport-input-gate";

/** Real DOM controls driven by CDP to test browser defaults alongside production Explorer input. */
export function installKeyboardPolicyFixture(
	keyboard: KeyboardInputPolicy,
	inputGate: ViewportInputGate,
) {
	const root = document.createElement("section");
	root.style.cssText =
		"position:fixed;right:20px;top:180px;z-index:10000;background:white;color:black;padding:20px;display:grid;gap:12px;width:320px";
	const canvas = document.createElement("canvas");
	canvas.dataset.gameViewport = "";
	canvas.id = "keyboard-viewport";
	canvas.width = 240;
	canvas.height = 30;
	canvas.style.background = "gray";
	const button = document.createElement("button");
	button.id = "keyboard-button";
	button.textContent = "Ordinary button";
	let clicks = 0;
	button.onclick = () => {
		clicks += 1;
	};
	const editor = document.createElement("input");
	editor.id = "keyboard-editor";
	const checkbox = document.createElement("input");
	checkbox.id = "keyboard-checkbox";
	checkbox.type = "checkbox";
	const range = document.createElement("input");
	range.id = "keyboard-range";
	range.type = "range";
	range.value = "0";
	const select = document.createElement("select");
	select.id = "keyboard-select";
	select.add(new Option("First", "first"));
	select.add(new Option("Second", "second"));
	const bar = document.createElement("div");
	bar.id = "keyboard-bar";
	bar.tabIndex = -1;
	bar.textContent = "Explicit keyboard surface";
	let presses = 0;
	let releases = 0;
	let cancels = 0;
	const scope = keyboard.scope(bar, {
		activation: (event) => event.ctrlKey && event.key === "1",
		keydown: (event) => {
			if (event.key !== "x") return;
			presses += 1;
			event.preventDefault();
		},
		keyup: (event) => {
			if (event.key === "x") releases += 1;
		},
		cancel: () => {
			cancels += 1;
		},
	});
	const dialog = document.createElement("dialog");
	dialog.id = "keyboard-modal";
	dialog.tabIndex = -1;
	const modalEditor = document.createElement("input");
	modalEditor.id = "keyboard-modal-editor";
	dialog.append(modalEditor);
	// A modal inside a registered scope must not forward keys to its containing scope.
	bar.append(dialog);
	root.append(canvas, button, editor, checkbox, range, select, bar);
	document.body.append(root);
	let modal: ReturnType<typeof keyboard.modal> | null = null;
	const closeModal = () => {
		modal?.destroy();
		modal = null;
	};
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		closeModal();
	});
	keyboard.returnToGame();
	const controller = new ExplorerCameraInputController({
		canvas,
		input: APP_INPUT,
		inputGate,
		keyboard,
		onChange() {},
		onPhysicalWheel() {},
		onPossessionOrbit() {},
		onPossessionWheel() {},
		onCharacterInput() {},
	});
	controller.setControlScheme({ kind: "physical-fly" });
	let disposed = false;
	return {
		capture: () => ({
			gameActive: keyboard.gameActive,
			pointerAllowed: inputGate.allowed,
			movement: controller.physicalFlyInput().movement,
			focused: document.activeElement?.id ?? "",
			focusLabel: document.activeElement?.getAttribute("aria-label"),
			editorValue: editor.value,
			checked: checkbox.checked,
			range: Number(range.value),
			selected: select.value,
			clicks,
			presses,
			releases,
			cancels,
		}),
		openModal: () => {
			modal = keyboard.modal(dialog);
		},
		closeModal,
		removeEditor: () => editor.remove(),
		unregisterScope: () => scope.destroy(),
		blurWindow: () => window.dispatchEvent(new Event("blur")),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			closeModal();
			scope.destroy();
			keyboard.returnToGame();
			controller.dispose();
			root.remove();
		},
	};
}
