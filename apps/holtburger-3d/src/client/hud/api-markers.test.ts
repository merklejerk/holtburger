import { describe, expect, it } from "vitest";
import { ApiWorldMarkersStore } from "./api-markers";
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
});
