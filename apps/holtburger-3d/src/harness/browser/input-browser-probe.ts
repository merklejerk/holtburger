import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import {
	ExplorerCameraInputController,
	type CharacterActionInput,
} from "../../explorer/explorer-camera-input-controller";
import { AppInput } from "../../lib/input/app-input";
import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
import type { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import { CharacterInputController } from "../../lib/game/controls/character-input-controller";
import { ClientInputArbiter } from "../../client/client-input-arbiter";
import { InputContext } from "../../lib/input/input-context";

/** Exercise configured Explorer input and DOM focus cancellation without runtime assets. */
export function probeBrowserInput(
	keyboard: KeyboardInputPolicy,
	inputGate: ViewportInputGate,
): void {
	const canvas = document.createElement("canvas");
	canvas.tabIndex = -1;
	canvas.dataset.gameViewport = "";
	const editor = document.createElement("input");
	document.body.append(canvas, editor);
	const actions: CharacterActionInput[] = [];
	const controller = new ExplorerCameraInputController({
		inputGate,
		keyboard,
		canvas,
		input: new AppInput({
			...INPUT_DEFAULTS,
			character: { ...INPUT_DEFAULTS.character, jump: [{ key: "F8" }] },
			fly: { ...INPUT_DEFAULTS.fly, ascend: [{ key: "F9" }, { key: "F10" }] },
		}),
		onChange() {},
		onPhysicalWheel() {},
		onPossessionOrbit() {},
		onPossessionWheel() {},
		onCharacterInput: (action) => actions.push(action),
	});
	const dispatch = (key: string, pressed: boolean, repeat = false): void => {
		canvas.dispatchEvent(
			new KeyboardEvent(pressed ? "keydown" : "keyup", {
				key,
				code: key,
				repeat,
				bubbles: true,
				cancelable: true,
			}),
		);
	};
	try {
		keyboard.returnToGame();
		controller.setControlScheme({ kind: "physical-fly" });
		dispatch("F9", true);
		dispatch("F10", true);
		dispatch("F9", false);
		if (controller.physicalFlyInput().movement.up !== 1)
			throw new Error("Alias release stopped a held fly action.");
		editor.focus();
		if (controller.physicalFlyInput().movement.up !== 0)
			throw new Error("DOM focus loss retained fly input.");
		keyboard.returnToGame();
		dispatch("F10", true, true);
		if (controller.physicalFlyInput().movement.up !== 0)
			throw new Error("Repeat resurrected cancelled fly input.");
		dispatch("F9", true);
		const revealScene = inputGate.block();
		const closeModal = inputGate.block();
		revealScene();
		dispatch("F10", true);
		if (controller.physicalFlyInput().movement.up !== 0)
			throw new Error("Explorer accepted input with a modal still blocking.");
		closeModal();
		dispatch("F9", false);
		dispatch("F10", true, true);
		if (controller.physicalFlyInput().movement.up !== 0)
			throw new Error("Reopening the gate resumed cancelled Explorer input.");
		controller.setControlScheme({ kind: "possessed-character" });
		dispatch("F8", true);
		editor.focus();
		if (
			JSON.stringify(actions) !==
			JSON.stringify([
				{ action: "jump", kind: "action", pressed: true },
				{ kind: "reset" },
			])
		)
			throw new Error(
				`Possession focus cancellation emitted unexpected actions: ${JSON.stringify(actions)}`,
			);
	} finally {
		controller.dispose();
		canvas.remove();
		editor.remove();
	}
	probeClientAutorun(keyboard);
}

/** Exercise real DOM focus with the production client movement owners, without a server. */
function probeClientAutorun(keyboard: KeyboardInputPolicy): void {
	const editor = document.createElement("input");
	const otherEditor = document.createElement("input");
	const dialog = document.createElement("dialog");
	document.body.append(editor, otherEditor, dialog);
	const commands: string[] = [];
	let autorun = false;
	const controller = new CharacterInputController({
		fullChargeDurationMs: 1000,
		now: () => performance.now(),
		onDrive: (drive, intent) =>
			commands.push(`${intent}:${drive.longitudinal}`),
		onEdge: (edge) => commands.push(edge.kind),
	});
	const arbiter = new ClientInputArbiter({
		ordinary: controller,
		powerBindings: INPUT_DEFAULTS.preciseJump,
		onEnter() {},
		onActivate() {},
		onCancel() {},
		onAutoRunChanged: (enabled) => {
			autorun = enabled;
		},
	});
	const input = new InputContext(
		{ turnLeft: [{ key: "F7" }], jump: [{ key: "F8" }] },
		(action, pressed) => arbiter.applyAction(action, pressed),
	);
	const detach = keyboard.bindGame({
		keydown: (event) => {
			input.apply(event, true);
		},
		keyup: (event) => {
			input.apply(event, false);
		},
		cancel: (reason) => {
			input.reset();
			if (reason === "focus-transfer") arbiter.releaseHeldActions();
			else arbiter.reset();
		},
	});
	const key = (value: string, down: boolean, repeat = false) =>
		window.dispatchEvent(
			new KeyboardEvent(down ? "keydown" : "keyup", {
				key: value,
				code: value,
				repeat,
				bubbles: true,
				cancelable: true,
			}),
		);
	const assertForward = () => {
		if (
			!autorun ||
			controller.drive().longitudinal !== "forward" ||
			controller.drive().turn !== null
		)
			throw new Error(
				"Editor handoff lost autorun or retained physical turning.",
			);
	};
	try {
		keyboard.returnToGame();
		arbiter.toggleAutoRun();
		key("F7", true);
		commands.length = 0;
		editor.focus();
		assertForward();
		if (commands.join() !== "synchronize:forward")
			throw new Error(
				`Ordinary editor focus interrupted movement ownership: ${commands}`,
			);
		otherEditor.focus();
		keyboard.returnToGame();
		key("F7", true, true);
		assertForward();
		key("F7", false);
		key("F7", true);
		if (controller.drive().turn !== "left")
			throw new Error("Fresh movement press was lost.");
		key("F8", true);
		commands.length = 0;
		editor.focus();
		assertForward();
		key("F8", false);
		if (
			commands.join() !== "reset,acquire:forward" ||
			controller.chargeExtent() !== null
		)
			throw new Error(
				`Editor focus failed to cancel charge before restoring autorun: ${commands}`,
			);
		window.dispatchEvent(new Event("blur"));
		if (autorun || controller.drive().longitudinal !== null)
			throw new Error("Window blur while editing retained autorun.");
		keyboard.returnToGame();
		arbiter.toggleAutoRun();
		arbiter.enterPrecise();
		editor.focus();
		assertForward();
		if (arbiter.preciseActive)
			throw new Error("Editor focus retained precise targeting.");
		const modal = keyboard.modal(dialog);
		try {
			if (autorun || controller.drive().longitudinal !== null)
				throw new Error("Modal opening while editing retained autorun.");
		} finally {
			modal.destroy();
		}
	} finally {
		detach();
		editor.remove();
		otherEditor.remove();
		dialog.remove();
		keyboard.returnToGame();
	}
}
