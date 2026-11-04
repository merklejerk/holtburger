import { describe, expect, it } from "vitest";
import { formGroupedObjectInstanceRuns } from "./object-rendering-policy";
import {
	PortalScopeAtlasOpaqueRouter,
	type PortalScopeAtlasOpaqueTileLookup,
} from "./portal-scope-atlas-opaque-routing";

const OUTDOOR_TILE = 0;
const FIRST_INDOOR_TILE = 1;
const SECOND_INDOOR_TILE = 2;
const TERRAIN_SUBMISSION_COUNT = 289;

class TestTileLookup implements PortalScopeAtlasOpaqueTileLookup {
	readonly requestedKeys: string[] = [];
	readonly #tileByScopeKey = new Map([
		["outdoor", OUTDOOR_TILE],
		["indoor-a", FIRST_INDOOR_TILE],
		["indoor-b", SECOND_INDOOR_TILE],
	]);

	tileOrdinalForRenderScopeKey(renderScopeKey: string): number {
		this.requestedKeys.push(renderScopeKey);
		const tile = this.#tileByScopeKey.get(renderScopeKey);
		if (tile === undefined) {
			throw new Error(`Unknown test scope ${renderScopeKey}.`);
		}
		return tile;
	}
}

describe("portal scope-atlas opaque routing", () => {
	it("shares one outdoor resolution across every existing terrain submission", () => {
		const router = new PortalScopeAtlasOpaqueRouter();
		const lookup = new TestTileLookup();
		const frame = router.beginFrame(lookup);

		const tile = router.routeTerrainPass(TERRAIN_SUBMISSION_COUNT);

		expect(tile).toBe(OUTDOOR_TILE);
		expect(lookup.requestedKeys).toEqual(["outdoor"]);
		expect(frame.trace).toEqual({
			objectSubmissionCount: 0,
			portalOwnedFrameHeapRecordCreationCount: 0,
			terrainSubmissionCount: TERRAIN_SUBMISSION_COUNT,
			tileResolutionCount: 1,
		});
	});

	it("routes each final grouped object run once without creating another schedule", () => {
		const inputs = [
			{
				cohort: "shared",
				compatible: "stone",
				id: "indoor-a/first",
				renderScopeKey: "indoor-a",
			},
			{
				cohort: "shared",
				compatible: "stone",
				id: "indoor-a/second",
				renderScopeKey: "indoor-a",
			},
			{
				cohort: "shared",
				compatible: "stone",
				id: "indoor-b/first",
				renderScopeKey: "indoor-b",
			},
		];
		const formed = formGroupedObjectInstanceRuns(
			inputs,
			() => true,
			(value) => `${value.renderScopeKey}/${value.cohort}`,
			(left, right) => left.compatible === right.compatible,
		);
		const router = new PortalScopeAtlasOpaqueRouter();
		const lookup = new TestTileLookup();
		const frame = router.beginFrame(lookup);
		const submittedRunIdentities: string[][] = [];
		const tileOrdinals: number[] = [];

		for (const submission of formed) {
			if (submission.kind !== "frame-instance-run") {
				throw new Error("Expected grouped frame-instance run.");
			}
			const representative = submission.values[0];
			tileOrdinals.push(
				router.routeObjectSubmission(representative.renderScopeKey),
			);
			submittedRunIdentities.push(submission.values.map(({ id }) => id));
		}

		expect(submittedRunIdentities).toEqual([
			["indoor-a/first", "indoor-a/second"],
			["indoor-b/first"],
		]);
		expect(tileOrdinals).toEqual([FIRST_INDOOR_TILE, SECOND_INDOOR_TILE]);
		expect(lookup.requestedKeys).toEqual(["indoor-a", "indoor-b"]);
		expect(frame.trace).toEqual({
			objectSubmissionCount: formed.length,
			portalOwnedFrameHeapRecordCreationCount: 0,
			terrainSubmissionCount: 0,
			tileResolutionCount: formed.length,
		});
	});

	it("routes an empty terrain pass without resolving a tile", () => {
		const router = new PortalScopeAtlasOpaqueRouter();
		const lookup = new TestTileLookup();
		const frame = router.beginFrame(lookup);

		expect(router.routeTerrainPass(0)).toBeNull();
		expect(lookup.requestedKeys).toEqual([]);
		expect(frame.trace.tileResolutionCount).toBe(0);
	});

	it("reuses an adjacent authored-scope resolution without retaining submissions", () => {
		const router = new PortalScopeAtlasOpaqueRouter();
		const lookup = new TestTileLookup();
		const frame = router.beginFrame(lookup);

		expect(router.routeObjectSubmission("indoor-a")).toBe(FIRST_INDOOR_TILE);
		expect(router.routeObjectSubmission("indoor-a")).toBe(FIRST_INDOOR_TILE);
		expect(router.routeObjectSubmission("indoor-b")).toBe(SECOND_INDOOR_TILE);

		expect(lookup.requestedKeys).toEqual(["indoor-a", "indoor-b"]);
		expect(frame.trace).toMatchObject({
			objectSubmissionCount: 3,
			portalOwnedFrameHeapRecordCreationCount: 0,
			tileResolutionCount: 2,
		});
	});

	it("reuses its frame record and rejects invalid call order", () => {
		const router = new PortalScopeAtlasOpaqueRouter();
		expect(() => router.routeObjectSubmission("outdoor")).toThrow(
			"no active frame",
		);
		expect(() => router.routeTerrainPass(-1)).toThrow(
			"non-negative safe integer",
		);

		const first = router.beginFrame(new TestTileLookup());
		router.routeTerrainPass(1);
		expect(() => router.routeTerrainPass(1)).toThrow("more than once");
		const second = router.beginFrame(new TestTileLookup());

		expect(second).toBe(first);
		expect(second.trace).toBe(first.trace);
		expect(second.trace).toEqual({
			objectSubmissionCount: 0,
			portalOwnedFrameHeapRecordCreationCount: 0,
			terrainSubmissionCount: 0,
			tileResolutionCount: 0,
		});
	});
});
