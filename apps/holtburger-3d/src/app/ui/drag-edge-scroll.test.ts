import { expect, it } from "vitest";
import { dragEdgeScrollFactor } from "./drag-edge-scroll";

it("ramps symmetrically at either edge and leaves the interior and exterior idle", () => {
	const factor = (pointer: number) =>
		dragEdgeScrollFactor(pointer, 100, 300, 40);
	expect(factor(100)).toBe(-1);
	expect(factor(120)).toBe(-0.5);
	expect(factor(200)).toBe(0);
	expect(factor(280)).toBe(0.5);
	expect(factor(300)).toBe(1);
	expect(factor(99)).toBe(0);
	expect(factor(301)).toBe(0);
});

it("keeps edge bands disjoint in short viewports and ignores empty clipped extents", () => {
	expect(dragEdgeScrollFactor(110, 100, 120, 40)).toBe(0);
	expect(dragEdgeScrollFactor(105, 100, 120, 40)).toBe(-0.5);
	expect(dragEdgeScrollFactor(115, 100, 120, 40)).toBe(0.5);
	expect(dragEdgeScrollFactor(100, 100, 100, 40)).toBe(0);
	expect(dragEdgeScrollFactor(100, 110, 100, 40)).toBe(0);
});
