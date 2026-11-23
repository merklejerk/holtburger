import { expect, it } from "vitest";
import { snapHudRectangle } from "./hud-snapping";
import {
	anchorHudPlacement,
	moveHudRectangle,
	resolveHudPlacement,
} from "./hud-geometry";

const viewport = { width: 800, height: 600 };
const options = { distance: 8, gap: 4 };
const peer = { left: 300, top: 200, width: 120, height: 80 };
const size = { width: 60, height: 40 };

it.each([
	["above", { left: 303, top: 159 }, { left: 300, top: 156 }],
	["below", { left: 357, top: 287 }, { left: 360, top: 284 }],
	["left", { left: 239, top: 203 }, { left: 236, top: 200 }],
	["right", { left: 427, top: 237 }, { left: 424, top: 240 }],
])(
	"snaps %s and aligns parallel edges with unequal extents",
	(_, raw, expected) => {
		expect(
			snapHudRectangle({ ...size, ...raw }, [peer], viewport, options),
		).toEqual({ ...size, ...expected });
	},
);

it("preserves a parallel position away from matching edges", () => {
	const moving = { ...size, left: 325, top: 158 };
	expect(snapHudRectangle(moving, [peer], viewport, options)).toEqual({
		...moving,
		top: 156,
	});
});

it("includes the attraction boundary and releases beyond it", () => {
	const target = peer.top - size.height - options.gap;
	const boundary = { ...size, left: peer.left, top: target - options.distance };
	expect(snapHudRectangle(boundary, [peer], viewport, options).top).toBe(
		target,
	);
	const beyond = { ...boundary, top: boundary.top - 1 };
	expect(snapHudRectangle(beyond, [peer], viewport, options)).toEqual(beyond);
});

it("does not attract distant collinear surfaces", () => {
	const moving = { ...size, left: 50, top: 158 };
	expect(snapHudRectangle(moving, [peer], viewport, options)).toEqual(moving);
});

it("chooses the closest valid peer", () => {
	const closer = { ...peer, top: 195 };
	const moving = { ...size, left: 300, top: 153 };
	const expected = { ...moving, top: 151 };
	expect(snapHudRectangle(moving, [peer, closer], viewport, options)).toEqual(
		expected,
	);
	expect(snapHudRectangle(moving, [closer, peer], viewport, options)).toEqual(
		expected,
	);
});

it("selects a clear alternative when a third surface blocks the nearest snap", () => {
	const moving = { ...size, left: 300, top: 153 };
	const blocker = { left: 315, top: 190, width: 10, height: 5 };
	expect(snapHudRectangle(moving, [peer, blocker], viewport, options)).toEqual({
		...moving,
		top: 146,
	});
});

it("rejects a snap crossing the viewport edge", () => {
	const edgePeer = { ...peer, top: 42 };
	const moving = { ...size, left: 300, top: 0 };
	expect(snapHudRectangle(moving, [edgePeer], viewport, options)).toEqual(
		moving,
	);
});

it("keeps the side snap when parallel-edge alignment is blocked", () => {
	const moving = { ...size, left: 304, top: 153 };
	const blocker = { left: 300, top: 193, width: 3, height: 5 };
	expect(snapHudRectangle(moving, [peer, blocker], viewport, options)).toEqual({
		...moving,
		top: peer.top - size.height - options.gap,
	});
});

it("preserves snapped geometry through preferred-size restoration and saved anchors", () => {
	const preferred = { width: 300, height: 40 };
	const minimum = { width: 40, height: 40 };
	const start = resolveHudPlacement(
		{
			horizontal: { alignment: "start", offset: 650 },
			vertical: { alignment: "start", offset: 100 },
			preferredWidth: preferred.width,
			preferredHeight: preferred.height,
		},
		viewport,
		minimum,
	);
	expect(start.width).toBeLessThan(preferred.width);
	const target = { left: 454, top: 100, width: 100, height: 100 };
	const desiredLeft = target.left - preferred.width - options.gap;
	const moving = moveHudRectangle(start, viewport, minimum, preferred, {
		x: desiredLeft - start.left + options.distance / 2,
		y: 0,
	});
	const snapped = snapHudRectangle(moving, [target], viewport, options);
	expect(snapped).toEqual({ ...preferred, left: desiredLeft, top: target.top });
	expect(
		resolveHudPlacement(
			anchorHudPlacement(snapped, viewport, preferred),
			viewport,
			minimum,
		),
	).toEqual(snapped);
});

it("preserves fractional CSS extents without rounding", () => {
	const moving = { left: 301.25, top: 159.5, width: 60.5, height: 40.25 };
	expect(snapHudRectangle(moving, [peer], viewport, options)).toEqual({
		...moving,
		left: peer.left,
		top: peer.top - moving.height - options.gap,
	});
});

it("leaves free movement unchanged without targets", () => {
	const moving = { ...size, left: 20, top: 30 };
	expect(snapHudRectangle(moving, [], viewport, options)).toEqual(moving);
});
