import { describe, expect, it } from "vitest";
import type { DatAssetId } from "../game-types";
import { resolveAuthoredTextureScroll } from "./authored-texture-scroll";
import type {
	PreparedPhysicsScript,
	PreparedPhysicsScriptClosure,
} from "./physics-script-repository";

function closure(
	scripts: Record<string, PreparedPhysicsScript["records"]>,
): PreparedPhysicsScriptClosure {
	return {
		release: () => {},
		rootId: "0x33000001" as DatAssetId,
		scripts: new Map(
			Object.entries(scripts).map(([id, records]) => [
				id as DatAssetId,
				{
					dependencies: { emitterInfoIds: [], scriptIds: [], soundIds: [] },
					id: id as DatAssetId,
					lengthSeconds: 0,
					records,
				},
			]),
		),
	};
}

const scroll = (uSpeed: number, vSpeed: number) =>
	[
		{
			authoredOrder: 0,
			kind: "texture-velocity" as const,
			startTime: 0,
			uSpeed,
			vSpeed,
		},
	] satisfies PreparedPhysicsScript["records"];

describe("resolveAuthoredTextureScroll", () => {
	it("returns null for a closure that authors no scroll", () => {
		expect(
			resolveAuthoredTextureScroll(closure({ "0x33000001": [] })),
		).toBeNull();
	});

	it("resolves a rate authored anywhere in the closure, not only in the root", () => {
		// A representative flowing-surface rate, reached through a chained script.
		expect(
			resolveAuthoredTextureScroll(
				closure({ "0x33000001": [], "0x33000002": scroll(0.03, 0.03) }),
			),
		).toEqual([0.03, 0.03]);
	});

	it("accepts the same rate authored more than once", () => {
		expect(
			resolveAuthoredTextureScroll(
				closure({
					"0x33000001": scroll(0.03, 0.03),
					"0x33000002": scroll(0.03, 0.03),
				}),
			),
		).toEqual([0.03, 0.03]);
	});

	it("refuses conflicting rates rather than picking a winner", () => {
		// Retail's registration is last-writer-wins; a derived phase cannot honor both, and the
		// archive contains no such case, so this is a content defect worth failing on.
		expect(() =>
			resolveAuthoredTextureScroll(
				closure({
					"0x33000001": scroll(0.03, 0.03),
					"0x33000002": scroll(0.01, 0.01),
				}),
			),
		).toThrow("conflicting texture scroll rates");
	});
});
