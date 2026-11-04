import { afterEach, describe, expect, it, vi } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { cellId } from "../lib/game/runtime/dynamic-entity-feed";
import { Quat, Vec3 } from "../lib/game/math/types";
import {
	formatClientLocation,
	runClientLocationCommand,
} from "./client-location-command";

afterEach(() => vi.unstubAllGlobals());

describe("location command", () => {
	it("keeps frame and cell identity while rounding poses into two compact lines", () => {
		const report = formatClientLocation(
			{
				landblockId: cellId(0xda550123),
				coords: { x: 1.23456789, y: -2, z: 3 },
				rotation: { w: 0.12345678, x: -0.000001, y: 0.5, z: -0.5 },
			},
			{
				landblockId: "0xda55ffff",
				envCellId: "0xda550124",
				position: sceneVec3(new Vec3(42000.123456789, 37, -16000)),
				rotation: new Quat(1, 0, 0, 0),
			},
		);
		expect(report).toBe(
			[
				"Player(AC) cell=0xda550123 pos=(1.235, -2, 3) quat(wxyz)=(0.1235, 0, 0.5, -0.5)",
				"Camera(scene) lb=0xda55ffff cell=0xda550124 pos=(42000.123, 37, -16000) quat(wxyz)=(1, 0, 0, 0)",
			].join("\n"),
		);
	});

	it.each([" @LOC ", " /LOC "])(
		"prints and copies identical content for %s",
		async (command) => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			const append = vi.fn();
			const report = "Player pose\nCamera pose";
			expect(
				await runClientLocationCommand(command, () => report, append),
			).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: report,
			});
			expect(writeText).toHaveBeenCalledExactlyOnceWith(report);
		},
	);

	it.each(["hello", "@location", "@loc extra", "/loc extra"])(
		"leaves %s to normal chat routing",
		async (message) => {
			const read = vi.fn();
			const append = vi.fn();
			expect(await runClientLocationCommand(message, read, append)).toBe(false);
			expect(read).not.toHaveBeenCalled();
			expect(append).not.toHaveBeenCalled();
		},
	);

	it("retains the report and exposes clipboard rejection", async () => {
		vi.stubGlobal("navigator", {
			clipboard: {
				writeText: vi.fn().mockRejectedValue(new Error("Permission denied")),
			},
		});
		const append = vi.fn();
		await expect(
			runClientLocationCommand("@loc", () => "pose", append),
		).rejects.toThrow(
			"Location printed, but clipboard copy failed: Permission denied",
		);
		expect(append).toHaveBeenCalledExactlyOnceWith({
			kind: "system",
			message: "pose",
		});
	});

	it("surfaces unavailable poses without printing a partial report", async () => {
		const append = vi.fn();
		await expect(
			runClientLocationCommand(
				"@loc",
				() => {
					throw new Error("Player location is unavailable.");
				},
				append,
			),
		).rejects.toThrow("Player location is unavailable.");
		expect(append).not.toHaveBeenCalled();
	});
});
