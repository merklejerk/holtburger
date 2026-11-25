import { describe, expect, it } from "vitest";
import { ApiWorldMarkersStore, MAX_API_MARKERS } from "./api-markers";
import type { ClientApiWorldMarker } from "../session/host-contract";

describe("ApiWorldMarkersStore", () => {
	it("projects rings and polylines, replaces by id, expires by TTL, and clears by namespace", () => {
		const store = new ApiWorldMarkersStore();
		const ring: ClientApiWorldMarker = {
			kind: "ring",
			id: "waypoint-1",
			namespace: "nav",
			position: [10, 2, -20],
			renderScopeKey: "outdoor",
			radius: 1.5,
			spin: true,
			color: [0.1, 0.9, 0.2, 1],
			ttlMs: 2_000,
		};
		const path: ClientApiWorldMarker = {
			kind: "polyline",
			id: "route",
			namespace: "combat",
			points: [
				[0, 0, 0],
				[5, 0, -5],
				[10, 1, -10],
			],
			renderScopeKeys: ["outdoor", "outdoor", "0x01020105"],
			color: [1, 0.5, 0, 0.8],
			ttlMs: 5_000,
		};

		store.upsert([ring, path], 1_000);
		const snap1 = store.snapshot(1_500);
		expect(snap1.markers).toHaveLength(1);
		expect(snap1.markers[0].radius).toBe(1.5);
		expect(snap1.markers[0].pending).toBe(true);
		expect(snap1.polylines).toHaveLength(1);
		expect(snap1.polylines[0].segments).toHaveLength(2);

		// Unchanged snapshot reuses the exact cached object (zero per-frame alloc).
		expect(store.snapshot(1_600)).toBe(snap1);

		// Ring expires at t = 3_000ms while polyline survives until t = 6_000ms.
		const snap2 = store.snapshot(3_000);
		expect(snap2.markers).toHaveLength(0);
		expect(snap2.polylines).toHaveLength(1);

		// Clearing by unrelated namespace leaves combat polyline intact.
		expect(store.clear("nav")).toBe(false);
		expect(store.snapshot(3_100).polylines).toHaveLength(1);

		// Clearing by matching namespace removes it cleanly.
		expect(store.clear("combat")).toBe(true);
		const snap3 = store.snapshot(3_200);
		expect(snap3.markers).toHaveLength(0);
		expect(snap3.polylines).toHaveLength(0);
	});

	it("resolves entity callouts by latest revision, preserves map identity across ring updates, and enforces MAX_API_MARKERS", () => {
		const store = new ApiWorldMarkersStore();
		const guid = 0x8000_0042;
		store.upsert(
			[
				{
					kind: "entity",
					id: "older",
					namespace: "base",
					guid,
					label: "Fallback",
					beacon: true,
					throughWall: false,
					color: [0.2, 0.8, 1, 0.9],
					ttlMs: 10_000,
				},
				{
					kind: "entity",
					id: "newer",
					namespace: "combat",
					guid,
					label: "Kill 1st",
					beacon: true,
					throughWall: true,
					color: [1, 0.2, 0.2, 0.95],
					ttlMs: 3_000,
				},
			],
			1_000,
		);

		const snap1 = store.snapshot(1_500);
		expect(snap1.entityCallouts.get(guid)?.label).toBe("Kill 1st");
		expect(snap1.entityCallouts.get(guid)?.throughWall).toBe(true);

		// Upserting a ring does not break referential identity of entityCallouts.
		store.upsert(
			[
				{
					kind: "ring",
					id: "r1",
					namespace: "nav",
					position: [1, 0, -2],
					renderScopeKey: "outdoor",
					radius: 1,
					spin: false,
					color: [0, 1, 0, 1],
					ttlMs: 5_000,
				},
			],
			1_600,
		);
		const snap2 = store.snapshot(1_700);
		expect(snap2.entityCallouts).toBe(snap1.entityCallouts);

		// Expiring the newer entity callout falls back cleanly to the surviving older one.
		const snap3 = store.snapshot(4_500);
		expect(snap3.entityCallouts.get(guid)?.label).toBe("Fallback");
		expect(snap3.entityCallouts.get(guid)?.throughWall).toBe(false);

		// Exceeding MAX_API_MARKERS evicts the oldest entries deterministically.
		const overflow: ClientApiWorldMarker[] = [];
		for (let i = 0; i < MAX_API_MARKERS + 5; i += 1) {
			overflow.push({
				kind: "ring",
				id: `bulk-${i}`,
				namespace: "bulk",
				position: [i, 0, 0],
				renderScopeKey: "outdoor",
				radius: 1,
				spin: false,
				color: [0.5, 0.5, 1, 1],
				ttlMs: 20_000,
			});
		}
		store.upsert(overflow, 5_000);
		const snap4 = store.snapshot(5_100);
		expect(snap4.markers.length + snap4.entityCallouts.size).toBe(
			MAX_API_MARKERS,
		);
		expect(store.clear(null)).toBe(true);
		expect(store.clear(null)).toBe(false);
		expect(store.snapshot(5_200).markers).toHaveLength(0);
	});
});
