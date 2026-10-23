import { CharacterInputController } from "../../lib/game/controls/character-input-controller";
import { ClientInputArbiter } from "../../client/client-input-arbiter";
import type { ClientMouseMovementInput } from "../../client/client-viewport-mouse-controller";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import type { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import { AppInput } from "../../lib/input/app-input";
import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";

/** Asset-free movement composition behind the production ClientWorldView DOM handlers. */
export function createClientMouseMovementFixture(
	keyboard: KeyboardInputPolicy,
	gate: ViewportInputGate,
	cancelMouse: () => void,
) {
	const turns: number[] = [];
	const errors: string[] = [];
	const edges: string[] = [];
	let autoRun = false;
	// Distinguish normal game Escape delivery from mouse-owned cancellation.
	let gameEscapeCount = 0;
	const controller = new CharacterInputController({
		fullChargeDurationMs: 1000,
		now: () => performance.now(),
		onDrive() {},
		onEdge: (edge) => edges.push(edge.kind),
	});
	const arbiter = new ClientInputArbiter({
		ordinary: controller,
		powerBindings: INPUT_DEFAULTS.preciseJump,
		onEnter() {},
		onActivate() {},
		onCancel() {},
		onAutoRunChanged: (enabled) => {
			autoRun = enabled;
		},
	});
	const movement: ClientMouseMovementInput = {
		onForward: (source, down) => arbiter.applyForward(source, down),
		onTurn: (delta) => turns.push(delta),
		onCancelTurn() {},
		onError: (message) => errors.push(message),
	};
	return {
		movement,
		state: () => ({
			drive: controller.drive(),
			turns: [...turns],
			errors: [...errors],
			edges: [...edges],
			autoRun,
			gameEscapeCount,
		}),
		reset: () => {
			gate.cancel();
			arbiter.reset();
			turns.length = 0;
			errors.length = 0;
			edges.length = 0;
			gameEscapeCount = 0;
		},
		toggleAutoRun: () => arbiter.toggleAutoRun(),
		precise: (enabled: boolean) => {
			if (enabled) arbiter.enterPrecise();
			else arbiter.deactivate();
		},
		block: () => gate.block(),
		bindKeyboard: () => {
			const input = new AppInput(INPUT_DEFAULTS).characterContext(
				(action, down) => arbiter.applyAction(action, down),
			);
			keyboard.returnToGame();
			return keyboard.bindGame({
				keydown: (event) => {
					if (event.key === "Escape") gameEscapeCount += 1;
					input.apply(event, true);
				},
				keyup: (event) => {
					input.apply(event, false);
				},
				cancel: (reason) => {
					cancelMouse();
					input.reset();
					if (reason === "focus-transfer") arbiter.releaseHeldActions();
					else arbiter.reset();
				},
			});
		},
	};
}
