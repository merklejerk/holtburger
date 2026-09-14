import { expect, it } from "vitest";
import {
	findActionBarClonePlacement,
	type ActionBarGeometry,
} from "./client-action-bar-layout";
import {
	anchorClientHudPlacement,
	resolveClientHudPlacement,
} from "./client-hud-layout";

const viewport = { width: 600, height: 400 };
const gap = 6;
const horizontal: ActionBarGeometry = {
	bounds: { left: 150, top: 360, width: 300, height: 40 },
	preferred: { width: 300, height: 40 },
};
it("stacks horizontal clones upward past existing bars and preserves anchors", () => {
	const first = findActionBarClonePlacement(
		horizontal,
		"horizontal",
		[horizontal.bounds],
		viewport,
		gap,
	);
	expect(first).toEqual({ left: 150, top: 314, width: 300, height: 40 });
	if (first === null) throw new Error("Expected free placement");
	const next = findActionBarClonePlacement(
		horizontal,
		"horizontal",
		[horizontal.bounds, first],
		viewport,
		gap,
	);
	expect(next).toEqual({ left: 150, top: 268, width: 300, height: 40 });
	const placement = anchorClientHudPlacement(
		first,
		viewport,
		horizontal.preferred,
	);
	expect(
		resolveClientHudPlacement(placement, viewport, horizontal.preferred),
	).toEqual(first);
});
it("uses below when a horizontal source sits at the top", () => {
	const source = { ...horizontal, bounds: { ...horizontal.bounds, top: 0 } };
	expect(
		findActionBarClonePlacement(
			source,
			"horizontal",
			[source.bounds],
			viewport,
			gap,
		),
	).toEqual({ ...source.bounds, top: 46 });
});
it.each([0, 560])(
	"places vertical clones toward the center from x=%s",
	(left) => {
		const source = {
			bounds: { left, top: 50, width: 40, height: 300 },
			preferred: { width: 40, height: 300 },
		};
		expect(
			findActionBarClonePlacement(
				source,
				"vertical",
				[source.bounds],
				viewport,
				gap,
			),
		).toEqual({ ...source.bounds, left: left === 0 ? 46 : 514 });
	},
);
it("finds a distant hole among mixed rectangles when adjacent positions are blocked", () => {
	const source = {
		bounds: { left: 0, top: 0, width: 100, height: 50 },
		preferred: { width: 100, height: 50 },
	};
	const blockers = [
		source.bounds,
		{ left: 106, top: 0, width: 494, height: 150 },
		{ left: 0, top: 56, width: 100, height: 150 },
	];
	expect(
		findActionBarClonePlacement(source, "horizontal", blockers, viewport, gap),
	).toEqual({ left: 106, top: 156, width: 100, height: 50 });
});
it("uses natural dimensions instead of copying temporary edge compression", () => {
	const source = {
		bounds: { left: 520, top: 360, width: 80, height: 40 },
		preferred: { width: 300.5, height: 40.5 },
	};
	expect(
		findActionBarClonePlacement(
			source,
			"horizontal",
			[source.bounds],
			viewport,
			gap,
		),
	).toEqual({ left: 299.5, top: 313.5, width: 300.5, height: 40.5 });
});
it("refuses a packed viewport rather than overlapping or shrinking to fit", () => {
	expect(
		findActionBarClonePlacement(
			horizontal,
			"horizontal",
			[{ left: 0, top: 0, ...viewport }],
			viewport,
			gap,
		),
	).toBeNull();
	expect(
		findActionBarClonePlacement(
			horizontal,
			"horizontal",
			[],
			{ width: 0, height: 0 },
			gap,
		),
	).toBeNull();
});
