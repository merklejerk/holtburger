import { describe, expect, it } from "vitest";
import type {
	ResolvedObjectBehavior,
	ResolvedObjectResident,
} from "./landblock-layer";
import { Mat4, Vec3 } from "../math/types";
import {
	classifyObjectResidents,
	resolveObjectBehavior,
} from "./object-resident-classifier";

describe("resolveObjectBehavior", () => {
	it.each([
		[null, null, null, "none"],
		["0x03000001", null, null, "animation-only"],
		[null, "0x33000001", null, "script-only"],
		[null, null, "0x34000001", "script-only"],
		["0x03000001", "0x33000001", null, "animation-and-script"],
	] as const)(
		"classifies animation %s, script %s, table %s as %s",
		(animationId, physicsScriptId, physicsScriptTableId, kind) => {
			expect(
				resolveObjectBehavior({
					animationId,
					physicsScriptId,
					physicsScriptTableId,
					soundTableId: null,
				}).kind,
			).toBe(kind);
		},
	);
});

describe("classifyObjectResidents", () => {
	it("promotes every resident with timed default behavior, including script-only", () => {
		const none = resident("none", behavior("none"));
		const script = resident("script", behavior("script-only"));
		const animation = resident("animation", behavior("animation-only"));
		const combined = resident("combined", behavior("animation-and-script"));

		const classified = classifyObjectResidents([
			none,
			script,
			animation,
			combined,
		]);

		// Retail enrolls a static object as animating for a default animation *or* a default
		// script, so only a resident with neither stays static.
		expect(classified.staticResidents).toEqual([none]);
		expect(
			classified.dynamicSources.map(({ identity }) => identity.sourceId),
		).toEqual(["script", "animation", "combined"]);
		expect(
			classified.dynamicSources.map(({ behavior }) => behavior.kind),
		).toEqual(["script-only", "animation-only", "animation-and-script"]);
	});

	it("rejects an impossible animated direct-GfxObj resident", () => {
		expect(() =>
			classifyObjectResidents([
				{ ...resident("direct", behavior("animation-only")), setupId: null },
			]),
		).toThrow("has no setup identity");
	});
});

function behavior(
	kind: ResolvedObjectBehavior["kind"],
): ResolvedObjectBehavior {
	return resolveObjectBehavior({
		animationId:
			kind === "animation-only" || kind === "animation-and-script"
				? "0x03000001"
				: null,
		physicsScriptId:
			kind === "script-only" || kind === "animation-and-script"
				? "0x33000001"
				: null,
		physicsScriptTableId: null,
		soundTableId: null,
	});
}

function resident(
	id: string,
	resolvedBehavior: ResolvedObjectBehavior,
): ResolvedObjectResident {
	return {
		behavior: resolvedBehavior,
		identity: { kind: "authored", sourceId: id },
		localBounds: null,
		placement: {
			envCellId: null,
			landblockId: "0xda55ffff",
			localTransform: Mat4.identity(),
		},
		presentation: {
			appearanceKey: `appearance:${id}`,
			lights: [],
			holdingLocations: new Map(),
			id: `presentation:${id}`,
			parts: [],
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: `setup-model/${id}`,
		},
		scale: new Vec3(1, 1, 1),
		setupId: "0x02000001",
	};
}
