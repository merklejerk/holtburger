import {
	ExplorerCameraInputController,
	type CharacterActionInput,
} from "../../explorer/explorer-camera-input-controller";
import { AppInput } from "../../lib/input/app-input";
import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
import { ViewportInputGate } from "../../lib/input/viewport-input-gate";

/** Exercise configured Explorer input and DOM focus cancellation without runtime assets. */
export function probeBrowserInput(): void {
	const canvas = document.createElement("canvas");
	canvas.tabIndex = 0;
	const editor = document.createElement("input");
	document.body.append(canvas, editor);
	const actions: CharacterActionInput[] = [];
	const inputGate = new ViewportInputGate();
	const controller = new ExplorerCameraInputController({
		inputGate,
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
		canvas.focus();
		controller.setControlScheme({ kind: "physical-fly" });
		dispatch("F9", true);
		dispatch("F10", true);
		dispatch("F9", false);
		if (controller.physicalFlyInput().movement.up !== 1)
			throw new Error("Alias release stopped a held fly action.");
		editor.focus();
		if (controller.physicalFlyInput().movement.up !== 0)
			throw new Error("DOM focus loss retained fly input.");
		canvas.focus();
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
}
