import { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import { ViewportInputGate } from "../lib/input/viewport-input-gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEntityMirror } from "./client-entity-mirror";
import { playerEntitySnapshot } from "./client-entity-mirror.test-support";
import { ClientEntitySelection } from "./client-entity-selection";
import {
	ClientCycleSelectionController,
	type CycleCandidate,
} from "./client-cycle-selection-controller";
import { ClientSelectionInput } from "./client-selection-input";
import { AppInput } from "../lib/input/app-input";
import { createInputDefaults } from "../lib/input/input-defaults";
import type { InputConfiguration } from "../lib/input/input-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

const HOLD_MS = 100;
// Own every binding consumed by ClientSelectionInput so editable defaults cannot
// change the tap, hold, modifier, or cancellation scenarios below.
const TEST_INPUT = {
	...createInputDefaults("windows"),
	client: {
		...createInputDefaults("windows").client,
		selectSelf: [],
		nextSmartCombat: [{ key: "Tab", shift: false, ctrl: false }],
		previousSmartCombat: [{ key: "Tab", shift: true, ctrl: false }],
		nextNonCreature: [{ key: "Tab", shift: false, ctrl: true }],
		previousNonCreature: [{ key: "Tab", shift: true, ctrl: true }],
		nextCorpse: [{ key: "v", shift: false, ctrl: false }],
		previousCorpse: [{ key: "v", shift: true, ctrl: false }],
		cancel: [{ key: "Escape" }],
	},
} satisfies InputConfiguration;

function key(options: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return Object.assign(
		new Event("keydown", { cancelable: true }),
		{
			key: "Tab",
			code: "Tab",
			shiftKey: false,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			repeat: false,
			isComposing: false,
		},
		options,
	) as KeyboardEvent;
}
function fixture() {
	const entities = new ClientEntityMirror();
	entities.commit(entities.prepareSnapshot(playerEntitySnapshot(1), 1));
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const selection = new ClientEntitySelection({
		lifecycle: {
			entities,
			tradeSnapshot: () => ({ trade: null }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		presentation: () => null,
	});
	const candidates: Record<
		"smartCombat" | "non-creature",
		readonly CycleCandidate[]
	> = {
		smartCombat: [
			{
				filters: { "smart-combat": "cycle" },
				guid: 2,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 1 },
				distanceSquared: 1,
			},
			{
				filters: { "smart-combat": "cycle" },
				guid: 3,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 4 },
				distanceSquared: 4,
			},
		],
		"non-creature": [
			{
				filters: { "non-creature": "cycle" },
				guid: 8,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: null,
				distanceSquared: 9,
			},
			{
				guid: 9,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: null,
				distanceSquared: 4,
				filters: { "non-creature": "cycle", corpse: "cycle" },
			},
		],
	};
	const sample = vi.fn(() => [
		...candidates.smartCombat,
		...candidates["non-creature"],
	]);
	const cycle = new ClientCycleSelectionController({
		selection,
		sample,
	});
	const keyboard = new KeyboardInputPolicy(new ViewportInputGate());
	const input = new ClientSelectionInput({
		keyboard,
		input: new AppInput(TEST_INPUT),
		selection,
		cycle,
		holdDelayMs: HOLD_MS,
	});
	return {
		selection,
		cycle,
		input,
		keyboard,
		sample,
		candidates,
		emit: (event: ClientLifecycleSessionEvent) => {
			for (const listener of listeners) listener(event);
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("selection press lifecycle", () => {
	it.each([
		[false, false, 2],
		[false, true, 2],
		[true, false, 9],
		[true, true, 9],
	] as const)(
		"cycles only on release for Control=%s Shift=%s",
		(ctrlKey, shiftKey, expected) => {
			const f = fixture();
			f.input.keydown(key({ ctrlKey, shiftKey }), 0);
			expect(f.selection.selectedGuid()).toBeNull();
			expect(f.sample).not.toHaveBeenCalled();
			f.input.keyup(key({ ctrlKey, shiftKey }), HOLD_MS - 1);
			expect(f.selection.selectedGuid()).toBe(expected);
			f.input.keyup(key({ ctrlKey, shiftKey }), HOLD_MS - 1);
			vi.advanceTimersByTime(HOLD_MS * 2);
			expect(f.sample).toHaveBeenCalledTimes(1);
			f.input.destroy();
		},
	);
	it("acquires current immediate once at the threshold without intermediate cycling or a release action", () => {
		const f = fixture();
		f.selection.select(2);
		f.input.keydown(key(), 0);
		expect(f.selection.selectedGuid()).toBe(2);
		vi.advanceTimersByTime(HOLD_MS - 1);
		expect(f.sample).not.toHaveBeenCalled();
		f.candidates.smartCombat = [
			{
				filters: { "smart-combat": "cycle" },
				guid: 4,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 1 },
				distanceSquared: 1,
			},
			{
				filters: { "smart-combat": "cycle" },
				guid: 2,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 4 },
				distanceSquared: 4,
			},
		];
		f.input.keydown(key({ repeat: true }), HOLD_MS - 1);
		vi.advanceTimersByTime(1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.input.keydown(key({ repeat: true }), HOLD_MS + 1);
		vi.advanceTimersByTime(HOLD_MS * 2);
		f.input.keyup(key(), HOLD_MS * 3);
		expect(f.selection.selectedGuid()).toBe(4);
		expect(f.sample).toHaveBeenCalledTimes(1);
		f.input.destroy();
	});
	it("holding Ctrl+Tab selects immediate non-creature without waiting for release", () => {
		const f = fixture();
		f.selection.select(3);
		f.input.keydown(key({ ctrlKey: true }), 0);
		expect(f.selection.selectedGuid()).toBe(3);
		vi.advanceTimersByTime(HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(9);
		f.input.keyup(key({ ctrlKey: true }), HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(9);
		expect(f.sample).toHaveBeenCalledTimes(1);
		f.input.destroy();
	});
	it.each([false, true])(
		"V cycles corpses in direction Shift=%s",
		(shiftKey) => {
			const f = fixture();
			const event = key({ key: shiftKey ? "V" : "v", code: "KeyV", shiftKey });
			f.input.keydown(event, 0);
			f.input.keyup(event, HOLD_MS - 1);
			expect(f.selection.selectedGuid()).toBe(9);
			expect(f.sample).toHaveBeenCalledWith();
			f.input.destroy();
		},
	);
	it.each([false, true])(
		"Shift holds select immediate once before release with Control=%s",
		(ctrlKey) => {
			const f = fixture();
			f.input.keydown(key({ shiftKey: true, ctrlKey }), 0);
			vi.advanceTimersByTime(HOLD_MS - 1);
			expect(f.sample).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(f.selection.selectedGuid()).toBe(ctrlKey ? 9 : 2);
			vi.advanceTimersByTime(HOLD_MS);
			f.input.keyup(key({ shiftKey: true, ctrlKey }), HOLD_MS * 2);
			expect(f.selection.selectedGuid()).toBe(ctrlKey ? 9 : 2);
			expect(f.sample).toHaveBeenCalledTimes(1);
			f.input.destroy();
		},
	);
	it("an overdue hold wins when release is processed before the timer callback", () => {
		const f = fixture();
		f.selection.select(3);
		f.input.keydown(key(), 0);
		// Advance the event timestamp without executing the pending timer task.
		f.input.keyup(key(), HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(2);
		vi.runAllTimers();
		expect(f.sample).toHaveBeenCalledTimes(1);
		f.input.destroy();
	});
	it.each([
		"focus",
		"modifier-down",
		"modifier-up",
		"selection",
		"recovery",
		"destroy",
	] as const)("cancels both tap and hold on %s", (reason) => {
		const f = fixture();
		f.selection.select(2);
		f.input.keydown(key(), 0);
		vi.advanceTimersByTime(HOLD_MS - 1);
		switch (reason) {
			case "focus":
				f.input.cancel();
				break;
			case "modifier-down":
				f.input.keydown(
					key({ key: "Control", code: "ControlLeft", ctrlKey: true }),
					1,
				);
				break;
			case "modifier-up":
				f.input.keyup(key({ key: "Shift", code: "ShiftLeft" }), 1);
				break;
			case "selection":
				f.selection.select(8);
				break;
			case "recovery":
				f.emit({ type: "resyncing" });
				break;
			case "destroy":
				f.input.destroy();
				break;
		}
		f.input.keyup(key(), HOLD_MS - 1);
		vi.runAllTimers();
		expect(f.sample).not.toHaveBeenCalled();
		expect(f.selection.selectedGuid()).toBe(reason === "selection" ? 8 : 2);
		f.input.destroy();
	});
	it("press intent invalidates older click results before the release chooses a target", () => {
		const f = fixture();
		f.selection.select(2);
		const old = f.selection.beginAcquisition("external");
		f.input.keydown(key(), 0);
		f.selection.commitAcquisition(old, 8);
		expect(f.selection.selectedGuid()).toBe(2);
		f.input.keyup(key(), 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.input.destroy();
	});
	it("empty held categories consume release while retaining the existing selection", () => {
		const f = fixture();
		f.selection.select(2);
		f.input.keydown(key(), 0);
		f.candidates.smartCombat = [];
		vi.advanceTimersByTime(HOLD_MS);
		f.input.keyup(key(), HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(2);
		expect(f.sample).toHaveBeenCalledTimes(1);
		f.input.destroy();
	});
	it("immediate acquisition breaks equal-alignment distance ties by GUID", () => {
		const f = fixture();
		f.cycle.cycle("smart-combat", 1);
		f.candidates.smartCombat = [
			{
				filters: { "smart-combat": "cycle" },
				guid: 5,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 1 },
				distanceSquared: 1,
			},
			{
				filters: { "smart-combat": "cycle" },
				guid: 4,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 1 },
				distanceSquared: 1,
			},
			{
				filters: { "smart-combat": "cycle" },
				guid: 2,
				distanceBand: 0,
				forwardAlignment: 1,
				smartImmediate: { distanceSquared: 4 },
				distanceSquared: 4,
			},
		];
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.input.destroy();
	});
});

describe("selection Escape ordering", () => {
	it("unwinds selection and windows by interaction recency before the system-menu fallback", () => {
		const f = fixture();
		const fallback = vi.fn();
		f.keyboard.bindGame({
			keydown: fallback,
			keyup: () => {},
			cancel: () => {},
		});
		const escape = () =>
			f.keyboard.keydown(key({ key: "Escape", code: "Escape" }));
		f.selection.select(2);
		const close = vi.fn();
		f.keyboard.bindEscapeContext(close);
		escape();
		expect(close).toHaveBeenCalledOnce();
		expect(f.selection.selectedGuid()).toBe(2);
		expect(fallback).not.toHaveBeenCalled();
		escape();
		expect(f.selection.selectedGuid()).toBeNull();
		expect(fallback).not.toHaveBeenCalled();
		escape();
		expect(fallback).toHaveBeenCalledOnce();
		const secondClose = vi.fn();
		f.keyboard.bindEscapeContext(secondClose);
		f.selection.select(3);
		escape();
		expect(f.selection.selectedGuid()).toBeNull();
		expect(secondClose).not.toHaveBeenCalled();
		escape();
		expect(secondClose).toHaveBeenCalledOnce();
		f.input.destroy();
	});

	it("releases selection cancellation on explicit clear and input teardown", () => {
		const f = fixture();
		const fallback = vi.fn();
		f.keyboard.bindGame({
			keydown: fallback,
			keyup: () => {},
			cancel: () => {},
		});
		f.selection.select(2);
		f.selection.select(null);
		f.keyboard.keydown(key({ key: "Escape", code: "Escape" }));
		expect(fallback).toHaveBeenCalledOnce();
		f.selection.select(3);
		f.input.destroy();
		f.keyboard.keydown(key({ key: "Escape", code: "Escape" }));
		expect(fallback).toHaveBeenCalledTimes(2);
	});

	it("lets empty cancellation fall through but consumes a pending acquisition", () => {
		const f = fixture();
		const escape = key({ key: "Escape", code: "Escape" });
		expect(f.input.keydown(escape, 0)).toBe(false);
		expect(escape.defaultPrevented).toBe(false);
		f.input.keydown(key(), 0);
		expect(f.input.keydown(key({ key: "Escape", code: "Escape" }), 0)).toBe(
			true,
		);
		vi.advanceTimersByTime(HOLD_MS);
		expect(f.sample).not.toHaveBeenCalled();
		f.input.destroy();
	});
});
