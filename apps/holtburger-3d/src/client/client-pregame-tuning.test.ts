import { describe, expect, it, vi } from "vitest";
import {
	choosePregameLocation,
	CLIENT_PREGAME_SCENE_TUNING,
} from "./client-pregame-tuning";

describe("pregame launch location choice", () => {
	it.each([0, 1 - Number.EPSILON])(
		"selects a configured location at random range boundary %s",
		(draw) => {
			const random = vi.spyOn(Math, "random").mockReturnValue(draw);
			try {
				const locations = CLIENT_PREGAME_SCENE_TUNING.locations;
				expect(choosePregameLocation()).toBe(
					draw === 0 ? locations[0] : locations.at(-1),
				);
			} finally {
				random.mockRestore();
			}
		},
	);
	it("reports an invalid random draw instead of installing an absent location", () => {
		const random = vi.spyOn(Math, "random").mockReturnValue(1);
		try {
			expect(() => choosePregameLocation()).toThrow(
				"Pregame location selection must resolve a configured entry.",
			);
		} finally {
			random.mockRestore();
		}
	});
});
