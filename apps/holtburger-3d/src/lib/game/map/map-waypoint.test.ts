import { describe, expect, it } from "vitest";
import { waypointTextSpans, waypointFromMapPoint } from "./map-waypoint";

import { sceneMapPoint, formatWorldMapCoordinates } from "./map-coordinates";
import { WORLD_MAP_EXTENT } from "../world-map/types";

describe("exact map destinations", () => {
	it("formats a label while retaining exact canonical geometry", () => {
		const position = sceneMapPoint(12345.6789, -23456.7891);
		const target = waypointFromMapPoint(position);
		expect(target).toEqual({
			position,
			label: formatWorldMapCoordinates(position),
		});
		expect(target?.position).toBe(position);
	});
	it.each([
		sceneMapPoint(WORLD_MAP_EXTENT, -1),
		sceneMapPoint(1, -WORLD_MAP_EXTENT),
		sceneMapPoint(-1, -1),
		sceneMapPoint(NaN, -1),
	])("rejects points outside navigable landscape: %s", (position) => {
		expect(waypointFromMapPoint(position)).toBeNull();
	});
});

describe("waypoint prose recognition", () => {
	it("preserves prose and the spelling of independently clickable coordinate pairs", () => {
		const text =
			"Holtburg (42.1N, 33.6E).\nThen 0.00s\n0.0w; or 42.345n 12.7890e!";
		const spans = waypointTextSpans(text);
		expect(spans.map((span) => span.text).join("")).toBe(text);
		expect(
			spans.flatMap((span) =>
				span.target === null ? [] : [span.target.label],
			),
		).toEqual(["42.1N, 33.6E", "0.00S, 0.0W", "42.345N, 12.7890E"]);
	});
	it.each([
		"-42N 12E",
		"+42N 12E",
		"id42N 12E",
		"42N 12East",
		"42N 12E_id",
		"1.42.3N 12E",
		"42N 1.12.7E",
		"42N 12E.5",
		"42N -12E",
		"42N",
		"42N, 12.",
		"102N 12E",
		"0S 102W",
		"42 12",
		"42N NaNE",
		`${"9".repeat(400)}N 12E`,
	])(
		"leaves malformed, embedded, truncated, and out-of-world text plain: %s",
		(text) => {
			expect(waypointTextSpans(text)).toEqual([{ text, target: null }]);
		},
	);
	it("keeps invalid candidates and separators while finding later valid pairs", () => {
		const text = "102N 0E, then 42N 12E / 0N0W.";
		const spans = waypointTextSpans(text);
		expect(spans.map((span) => span.text).join("")).toBe(text);
		expect(
			spans.filter((span) => span.target !== null).map((span) => span.text),
		).toEqual(["42N 12E", "0N0W"]);
		expect(waypointTextSpans("")).toEqual([]);
	});
});
