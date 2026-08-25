import { describe, expect, it } from "vitest";

import { sceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import {
	createExplorerLaunchRequest,
	createExplorerSpawnRequest,
	decodeExplorerWeenieSearchRequest,
	decodeExplorerWeenieSearchResults,
	EXPLORER_SPAWN_DISTANCE,
	EXPLORER_WEENIE_SEARCH_RESULT_LIMIT,
	isExplorerSpawnDistanceOnStep,
	parseExplorerWcid,
} from "./explorer-entity-commands";

describe("Explorer entity commands", () => {
	it("offers a default spawn distance the number control accepts", () => {
		// A number input rejects values off `minimum + step * k`, and the browser blocks submit
		// before any handler runs. A default of 5 against a 0.1 minimum and 0.5 step was exactly
		// that: the untouched form refused to spawn.
		expect(isExplorerSpawnDistanceOnStep(EXPLORER_SPAWN_DISTANCE.default)).toBe(
			true,
		);
		expect(EXPLORER_SPAWN_DISTANCE.default).toBeGreaterThanOrEqual(
			EXPLORER_SPAWN_DISTANCE.minimum,
		);
		expect(isExplorerSpawnDistanceOnStep(0.1)).toBe(false);
	});

	it("accepts only decimal or explicitly prefixed hexadecimal WCIDs", () => {
		expect(parseExplorerWcid(" 42 ")).toBe(42);
		expect(parseExplorerWcid("0x2A")).toBe(42);
		expect(() => parseExplorerWcid("2a")).toThrow("decimal or prefixed");
		expect(() => parseExplorerWcid("0x100000000")).toThrow("unsigned 32-bit");
	});

	it("decodes only complete bounded-result identities", () => {
		const result = { wcid: 42, name: "Drudge", className: "drudge" };
		expect(decodeExplorerWeenieSearchResults([result])).toEqual([result]);
		expect(() =>
			decodeExplorerWeenieSearchResults([
				{ wcid: -1, name: "Drudge", className: "drudge" },
			]),
		).toThrow();
		expect(() =>
			decodeExplorerWeenieSearchResults([
				{ wcid: 42, name: "", className: "drudge" },
			]),
		).toThrow();
		expect(() =>
			decodeExplorerWeenieSearchResults(
				Array.from(
					{ length: EXPLORER_WEENIE_SEARCH_RESULT_LIMIT + 1 },
					() => result,
				),
			),
		).toThrow();
		expect(() => decodeExplorerWeenieSearchResults([result, result])).toThrow(
			"Duplicate search-result WCID",
		);
		expect(() =>
			decodeExplorerWeenieSearchRequest({
				query: "drudge",
				limit: EXPLORER_WEENIE_SEARCH_RESULT_LIMIT + 1,
			}),
		).toThrow();
	});

	it("snapshots an indoor camera into its owner frame and normalizes the view vector", () => {
		const request = createExplorerSpawnRequest(
			42,
			{
				position: sceneVec3(new Vec3(2 * 192 + 10, 30, -(3 * 192 + 20))),
				residency: {
					envCellId: "0x02030123",
					landblockId: "0x0203ffff",
				},
			},
			[0, 2, 0],
			5,
			"simulated",
		);

		expect(request).toEqual({
			wcid: 42,
			cameraPose: {
				landblockId: 0x02030123,
				coords: { x: 10, y: 20, z: 30 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			candidate: { x: 10, y: 25, z: 30 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
			physicalIntent: "simulated",
		});
	});

	it("uses an outdoor owner frame instead of treating the frontend owner sentinel as an EnvCell", () => {
		const request = createExplorerSpawnRequest(
			42,
			{
				position: sceneVec3(new Vec3(0, 30, 0)),
				residency: { envCellId: null, landblockId: "0xda55ffff" },
			},
			[0, 2, 0],
			5,
			"pose-only",
		);

		expect(request.cameraPose.landblockId).toBe(0xda55_0000);
	});

	it("validates launch identity and direction without choosing speed", () => {
		expect(createExplorerLaunchRequest(0xf0000001, 7, [3, 4, 0])).toEqual({
			guid: 0xf0000001,
			generation: 7,
			direction: { x: 3, y: 4, z: 0 },
		});
		expect(() => createExplorerLaunchRequest(1, 1, [0, 0, 0])).toThrow(
			"finite and nonzero",
		);
	});
});
