import { describe, expect, it, vi } from "vitest";
import {
	GroundedCharacterInput,
	type GroundedCharacterDrive,
	type GroundedCharacterEdge,
} from "./grounded-character-input";

function fixture() {
	let now = 1_000;
	const drives: GroundedCharacterDrive[] = [];
	const edges: GroundedCharacterEdge[] = [];
	const input = new GroundedCharacterInput({
		fullChargeDurationMs: 1_000,
		now: () => now,
		onDrive: (drive) => drives.push(drive),
		onEdge: (edge) => edges.push(edge),
	});
	return { drives, edges, input, setNow: (value: number) => (now = value) };
}

describe("GroundedCharacterInput", () => {
	it("composes independent axes and maps Shift to walk gait", () => {
		const { input } = fixture();
		input.applyKey("w", true);
		input.applyKey("z", true);
		input.applyKey("d", true);
		input.applyKey("shift", true);

		expect(input.drive()).toEqual({
			gait: "walk",
			lateral: "left",
			longitudinal: "forward",
			turn: "right",
		});
	});

	it.each([
		["w", "s"],
		["z", "c"],
		["a", "d"],
	] as const)(
		"uses newest-first precedence and resumes %s after releasing %s",
		(first, second) => {
			const { input } = fixture();
			input.applyKey(first, true);
			const firstDrive = input.drive();
			input.applyKey(second, true);
			expect(input.drive()).not.toEqual(firstDrive);
			input.applyKey(second, false);
			expect(input.drive()).toEqual(firstDrive);
		},
	);

	it("releasing a non-head key does not replace the active command", () => {
		const { input } = fixture();
		input.applyKey("w", true);
		input.applyKey("s", true);
		const active = input.drive();
		input.applyKey("w", false);
		expect(input.drive()).toEqual(active);
	});

	it("ignores keyboard repeat without changing axis precedence", () => {
		const { drives, input } = fixture();
		input.applyKey("w", true);
		input.applyKey("s", true);
		input.applyKey("w", true, true);
		expect(input.drive().longitudinal).toBe("backward");
		expect(drives).toHaveLength(2);
	});

	it("uses one clock calculation for tap, display, and released extent", () => {
		const { edges, input, setNow } = fixture();
		input.applyKey("space", true);
		expect(input.chargeExtent()).toBe(0.001);
		setNow(1_500);
		expect(input.chargeExtent()).toBe(0.5);
		input.applyKey("space", false);
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

	it("clamps over-full charge and ignores release without an active charge", () => {
		const { edges, input, setNow } = fixture();
		input.applyKey("space", false);
		input.applyKey("space", true);
		setNow(3_000);
		input.applyKey("space", false);
		expect(edges.at(-1)).toMatchObject({ extent: 1, kind: "release-jump" });
	});

	it("cancels only the optimistic charge belonging to a rejected begin", () => {
		const { input } = fixture();
		input.applyKey("space", true);
		input.rejectBegin(99);
		expect(input.chargeExtent()).not.toBeNull();
		input.rejectBegin(0);
		expect(input.chargeExtent()).toBeNull();
	});

	it("focus reset clears every list and emits a sequenced reset", () => {
		const { edges, input } = fixture();
		input.applyKey("w", true);
		input.applyKey("s", true);
		input.applyKey("z", true);
		input.applyKey("d", true);
		input.applyKey("shift", true);
		input.applyKey("space", true);
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
				new GroundedCharacterInput({
					fullChargeDurationMs: Number.NaN,
					now: vi.fn(),
					onDrive: vi.fn(),
					onEdge: vi.fn(),
				}),
		).toThrow("finite and positive");
	});
});
