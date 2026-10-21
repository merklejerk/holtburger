import { ExplorerCameraInputController } from "../../explorer/explorer-camera-input-controller";
import { APP_INPUT } from "../../lib/input/app-input";
import type {
	EscapeContextHandle,
	KeyboardInputPolicy,
} from "../../lib/input/keyboard-input-policy";
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
	/** Delivered world edges expose click-through independently of camera behavior. */
	const viewportEvents: string[] = [];
	for (const type of [
		"pointerdown",
		"pointerup",
		"click",
		"auxclick",
		"contextmenu",
	]) {
		canvas.addEventListener(type, (event) => {
			viewportEvents.push(event.type);
			if (event.type === "contextmenu") event.preventDefault();
		});
	}
	const button = document.createElement("button");
	button.id = "keyboard-button";
	button.textContent = "Ordinary button";
	let clicks = 0;
	button.onclick = () => {
		clicks += 1;
	};
	const selectableText = document.createElement("p");
	selectableText.id = "keyboard-selectable-text";
	selectableText.textContent = "Ordinary selectable HUD text";
	selectableText.style.userSelect = "text";
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
	const disabledOption = new Option("Unavailable", "unavailable");
	disabledOption.disabled = true;
	select.add(disabledOption);
	select.add(new Option("Second", "second"));
	select.add(new Option("Third", "third"));
	// Exercise the shared in-page picker without a native-control keyboard scope.
	const selectTheme = document.createElement("div");
	selectTheme.className = "ui-theme";
	selectTheme.append(select);
	// Match the broad native-control registration used by Settings/trade/vendor panels.
	const nativePanel = document.createElement("div");
	nativePanel.style.cssText =
		"position:absolute;right:calc(100% + 12px);top:0;width:300px;padding:12px;background:white;display:grid;gap:8px";
	const nativeScope = keyboard.scope(nativePanel, {
		nativeControls: true,
		keydown: () => {},
	});
	const nativeEditor = document.createElement("input");
	nativeEditor.id = "keyboard-native-editor";
	const nativeButton = document.createElement("button");
	nativeButton.id = "keyboard-native-button";
	const buttonIcon = document.createElement("span");
	buttonIcon.id = "keyboard-native-button-icon";
	buttonIcon.textContent = "Nested native-scope button";
	nativeButton.append(buttonIcon);
	let nativeClicks = 0;
	nativeButton.onclick = () => {
		nativeClicks++;
	};
	const nativeCheckbox = document.createElement("input");
	nativeCheckbox.type = "checkbox";
	nativeCheckbox.id = "keyboard-native-checkbox";
	const nativeLabel = document.createElement("label");
	const labelText = document.createElement("span");
	labelText.id = "keyboard-native-label";
	labelText.textContent = "Toggle through label";
	nativeLabel.append(nativeCheckbox, labelText);
	const nativeRange = document.createElement("input");
	nativeRange.type = "range";
	nativeRange.id = "keyboard-native-range";
	nativeRange.value = "0";
	const nativeTab = document.createElement("button");
	nativeTab.id = "keyboard-native-tab";
	nativeTab.setAttribute("role", "tab");
	nativeTab.textContent = "Panel tab";
	let nativeTabClicks = 0;
	nativeTab.onclick = () => {
		nativeTabClicks++;
	};
	const nativeDisclosure = document.createElement("details");
	const summary = document.createElement("summary");
	summary.id = "keyboard-native-summary";
	summary.textContent = "Panel subsection";
	nativeDisclosure.append(summary);
	nativePanel.append(
		nativeEditor,
		nativeButton,
		nativeLabel,
		nativeRange,
		nativeTab,
		nativeDisclosure,
	);

	const bar = document.createElement("div");
	bar.id = "keyboard-bar";
	bar.tabIndex = -1;
	bar.textContent = "Explicit keyboard surface";
	let presses = 0;
	let releases = 0;
	let cancels = 0;
	const scope = keyboard.scope(bar, {
		activation: (event) => event.ctrlKey && event.key === "F8",
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
	dialog.className = "ui-theme";
	const modalEditor = document.createElement("input");
	modalEditor.id = "keyboard-modal-editor";
	const modalSelect = document.createElement("select");
	modalSelect.id = "keyboard-modal-select";
	modalSelect.add(new Option("First", "first"));
	modalSelect.add(new Option("Second", "second"));
	dialog.append(modalEditor, modalSelect);
	// A modal inside a registered scope must not forward keys to its containing scope.
	bar.append(dialog);
	root.append(
		canvas,
		button,
		selectableText,
		editor,
		checkbox,
		range,
		selectTheme,
		nativePanel,
		bar,
	);
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
	/** Synthetic activity competes with production windows through the real keyboard boundary. */
	let activity: EscapeContextHandle | null = null;
	let activityCancellations = 0;
	return {
		beginEscapeActivity: () => {
			if (activity !== null) activity.promote();
			else
				activity = keyboard.bindEscapeContext(() => {
					activity = null;
					activityCancellations += 1;
				});
		},
		capture: () => ({
			activityCancellations,
			viewportEvents: [...viewportEvents],
			camera: controller.snapshotState(),
			gameActive: keyboard.gameActive,
			pointerAllowed: inputGate.allowed,
			movement: controller.physicalFlyInput().movement,
			focused: document.activeElement?.id ?? "",
			focusLabel: document.activeElement?.getAttribute("aria-label"),
			editorValue: editor.value,
			checked: checkbox.checked,
			range: Number(range.value),
			selected: select.value,
			nativeClicks,
			nativeTabClicks,
			nativeChecked: nativeCheckbox.checked,
			nativeRange: Number(nativeRange.value),
			nativeDisclosure: nativeDisclosure.open,
			nativeEditorValue: nativeEditor.value,
			clicks,
			presses,
			releases,
			cancels,
		}),
		focusNativeButton: async () => {
			// Finish the browser's click-default task before starting a new deliberate focus action.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			nativeButton.focus();
		},
		openModal: () => {
			modal = keyboard.modal(dialog);
		},
		closeModal,
		selectOrdinaryText: () => {
			const range = document.createRange();
			range.selectNodeContents(selectableText);
			const selection = document.getSelection();
			if (selection === null)
				throw new Error("Document selection is unavailable.");
			selection.removeAllRanges();
			selection.addRange(range);
			return selection.toString();
		},
		removeEditor: () => editor.remove(),
		unregisterScope: () => scope.destroy(),
		blurWindow: () => window.dispatchEvent(new Event("blur")),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			activity?.release();
			closeModal();
			scope.destroy();
			nativeScope.destroy();
			keyboard.returnToGame();
			controller.dispose();
			root.remove();
		},
	};
}
