import { describe, expect, it, vi } from "vitest";
import {
	CharacterInputController,
	type CharacterDrive,
	type CharacterDriveIntent,
	type CharacterInputEdge,
} from "./character-input-controller";

function fixture() {
	let now = 1_000;
	const drives: CharacterDrive[] = [];
	const intents: CharacterDriveIntent[] = [];
	const edges: CharacterInputEdge[] = [];
	const input = new CharacterInputController({
		fullChargeDurationMs: 1_000,
		now: () => now,
		onDrive: (drive, intent) => {
			drives.push(drive);
			intents.push(intent);
		},
		onEdge: (edge) => edges.push(edge),
	});
	return {
		drives,
		intents,
		edges,
		input,
		setNow: (value: number) => (now = value),
	};
}

describe("CharacterInputController", () => {
	it("preserves acquisition versus synchronization independently of drive contents", () => {
		const { input, drives, intents, edges } = fixture();
		input.applyAction("forward", true);
		input.applyAction("forward", true);
		input.applyAction("walk", true);
		input.applyAction("walk", false);
		input.applyAction("forward", false);
		input.restoreHeldAction("forward");
		expect(intents).toEqual([
			"acquire",
			"acquire",
			"synchronize",
			"synchronize",
			"synchronize",
		]);
		expect(drives[0]).toEqual(drives[4]);
		input.reset();
		expect(intents).toHaveLength(5);
		expect(edges.at(-1)?.kind).toBe("reset");
	});

	it("composes independent axes and selects walk gait", () => {
		const { input } = fixture();
		input.applyAction("forward", true);
		input.applyAction("strafeLeft", true);
		input.applyAction("turnRight", true);
		input.applyAction("walk", true);

		expect(input.drive()).toEqual({
			gait: "walk",
			lateral: "left",
			longitudinal: "forward",
			turn: "right",
		});
	});

	it.each([
		["forward", "backward"],
		["strafeLeft", "strafeRight"],
		["turnLeft", "turnRight"],
	] as const)(
		"uses newest-first precedence and resumes %s after releasing %s",
		(first, second) => {
			const { input } = fixture();
			input.applyAction(first, true);
			const firstDrive = input.drive();
			input.applyAction(second, true);
			expect(input.drive()).not.toEqual(firstDrive);
			input.applyAction(second, false);
			expect(input.drive()).toEqual(firstDrive);
		},
	);

	it("releasing a non-head key does not replace the active command", () => {
		const { input } = fixture();
		input.applyAction("forward", true);
		input.applyAction("backward", true);
		const active = input.drive();
		input.applyAction("forward", false);
		expect(input.drive()).toEqual(active);
	});

	it("ignores duplicate action presses without changing axis precedence", () => {
		const { drives, input } = fixture();
		input.applyAction("forward", true);
		input.applyAction("backward", true);
		input.applyAction("forward", true);
		expect(input.drive().longitudinal).toBe("backward");
		expect(drives).toHaveLength(2);
	});

	it("uses one clock calculation for tap, display, and released extent", () => {
		const { edges, input, setNow } = fixture();
		input.applyAction("jump", true);
		expect(input.chargeExtent()).toBe(0.001);
		setNow(1_500);
		expect(input.chargeExtent()).toBe(0.5);
		input.applyAction("jump", false);
		expect(edges).toEqual([
			{
				drive: input.drive(),
				kind: "begin-jump",
				sequence: 0,
			},
			{
				drive: input.drive(),
				extent: 0.5,
				kind: "release-jump",
				sequence: 1,
			},
		]);
		expect(input.chargeExtent()).toBeNull();
	});

	it("snapshots Shift walk gait into both manual jump edges", () => {
		const { edges, input } = fixture();
		input.applyAction("forward", true);
		input.applyAction("walk", true);
		input.applyAction("jump", true);
		input.applyAction("jump", false);

		expect(edges).toMatchObject([
			{ drive: { gait: "walk", longitudinal: "forward" }, kind: "begin-jump" },
			{
				drive: { gait: "walk", longitudinal: "forward" },
				kind: "release-jump",
			},
		]);
	});

	it("clamps over-full charge and ignores release without an active charge", () => {
		const { edges, input, setNow } = fixture();
		input.applyAction("jump", false);
		input.applyAction("jump", true);
		setNow(3_000);
		input.applyAction("jump", false);
		expect(edges.at(-1)).toMatchObject({ extent: 1, kind: "release-jump" });
	});

	it("recomputes an active charge from the same start when stance timing changes", () => {
		const { input, setNow } = fixture();
		input.applyAction("jump", true);
		setNow(1_400);
		expect(input.chargeExtent()).toBe(0.4);
		input.setFullChargeDurationMs(800);
		expect(input.chargeExtent()).toBe(0.5);
	});

	it("cancels only the optimistic charge belonging to a rejected begin", () => {
		const { input } = fixture();
		input.applyAction("jump", true);
		input.rejectBegin(99);
		expect(input.chargeExtent()).not.toBeNull();
		input.rejectBegin(0);
		expect(input.chargeExtent()).toBeNull();
	});

	it("focus reset clears every list and emits a sequenced reset", () => {
		const { edges, input } = fixture();
		input.applyAction("forward", true);
		input.applyAction("backward", true);
		input.applyAction("strafeLeft", true);
		input.applyAction("turnRight", true);
		input.applyAction("walk", true);
		input.applyAction("jump", true);
		input.reset();

		expect(input.drive()).toEqual({
			gait: "run",
			lateral: null,
			longitudinal: null,
			turn: null,
		});
		expect(input.chargeExtent()).toBeNull();
		expect(edges.at(-1)).toEqual({ kind: "reset", sequence: 1 });
	});

	it("rejects an invalid charge profile", () => {
		expect(
			() =>
				new CharacterInputController({
					fullChargeDurationMs: Number.NaN,
					now: vi.fn(),
					onDrive: vi.fn(),
					onEdge: vi.fn(),
				}),
		).toThrow("finite and positive");
	});
});
