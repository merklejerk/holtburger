import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientEntitySelection } from "./client-entity-selection";
import {
	ClientCycleSelectionController,
	type CycleCandidate,
	type CycleCategory,
} from "./client-cycle-selection-controller";
import { ClientSelectionInput } from "./client-selection-input";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

const HOLD_MS = 100;
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
	entities.commit(
		entities.prepareSnapshot(
			{ worldContainer: { kind: "closed" }, entities: [entityFacts(1)] },
			1,
		),
	);
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const selection = new ClientEntitySelection({
		lifecycle: {
			entities,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		presentation: () => null,
	});
	const candidates: Record<CycleCategory, readonly CycleCandidate[]> = {
		creature: [
			{ guid: 2, distanceSquared: 1 },
			{ guid: 3, distanceSquared: 4 },
		],
		"non-creature": [
			{ guid: 8, distanceSquared: 9 },
			{ guid: 9, distanceSquared: 4 },
		],
	};
	const sample = vi.fn((category: CycleCategory) => candidates[category]);
	const cycle = new ClientCycleSelectionController({
		selection,
		sample,
		policy: { radiusMeters: 50, idleResetMs: 10, viewMarginMeters: 2 },
	});
	const input = new ClientSelectionInput({
		selection,
		cycle,
		holdDelayMs: HOLD_MS,
	});
	return {
		selection,
		cycle,
		input,
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
		[false, true, 3],
		[true, false, 9],
		[true, true, 8],
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
	it("acquires current nearest once at the threshold without intermediate cycling or a release action", () => {
		const f = fixture();
		f.selection.select(2);
		f.input.keydown(key(), 0);
		expect(f.selection.selectedGuid()).toBe(2);
		vi.advanceTimersByTime(HOLD_MS - 1);
		expect(f.sample).not.toHaveBeenCalled();
		f.candidates.creature = [
			{ guid: 4, distanceSquared: 1 },
			{ guid: 2, distanceSquared: 4 },
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
	it("holding Ctrl+Tab selects nearest non-creature without waiting for release", () => {
		const f = fixture();
		f.selection.select(3);
		f.input.keydown(key({ ctrlKey: true }), 0);
		expect(f.selection.selectedGuid()).toBe(3);
		vi.advanceTimersByTime(HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(9);
		f.input.keyup(key({ ctrlKey: true }), HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(9);
		expect(f.sample.mock.calls.map(([category]) => category)).toEqual([
			"non-creature",
		]);
		f.input.destroy();
	});
	it.each([false, true])(
		"Shift holds select nearest once before release with Control=%s",
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
		f.candidates.creature = [];
		vi.advanceTimersByTime(HOLD_MS);
		f.input.keyup(key(), HOLD_MS);
		expect(f.selection.selectedGuid()).toBe(2);
		expect(f.sample).toHaveBeenCalledTimes(1);
		f.input.destroy();
	});
	it("nearest acquisition ignores stable cycle order and breaks distance ties by GUID", () => {
		const f = fixture();
		f.cycle.cycle("creature", 1, 0);
		f.candidates.creature = [
			{ guid: 5, distanceSquared: 1 },
			{ guid: 4, distanceSquared: 1 },
			{ guid: 2, distanceSquared: 4 },
		];
		f.cycle.selectNearest("creature");
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("creature", 1, 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.input.destroy();
	});
});
