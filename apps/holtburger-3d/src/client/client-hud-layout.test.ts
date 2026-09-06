import { describe, expect, it } from "vitest";

import {
	anchorClientHudPlacement,
	createClientHudLayout,
	createClientHudPanelPlacement,
	resizeClientPanelRectangle,
	resolveClientHudPlacement,
	resolveClientHudSquarePlacement,
} from "./client-hud-layout";

import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";

const PANEL_MINIMUM = { width: 280, height: 240 };

describe("client HUD layout", () => {
	it("builds each configured surface through the placement resolver", () => {
		const viewport = { width: 1344, height: 820 };
		const shortcutCount = 8;
		const layout = createClientHudLayout(
			CLIENT_UI_DEFAULTS,
			viewport,
			shortcutCount,
		);
		for (const key of Object.keys(layout) as (keyof typeof layout)[]) {
			const panel = CLIENT_UI_DEFAULTS[key];
			const size =
				typeof panel.size === "number"
					? { width: panel.size, height: panel.size }
					: panel.size;
			expect(layout[key]).toEqual(
				createClientHudPanelPlacement(
					{ ...panel, size },
					viewport,
					shortcutCount,
				),
			);
		}
	});

	it.each([
		["top-left", "start", "start"],
		["top-center", "center", "start"],
		["top-right", "end", "start"],
		["center-left", "start", "center"],
		["center", "center", "center"],
		["center-right", "end", "center"],
		["bottom-left", "start", "end"],
		["bottom-center", "center", "end"],
		["bottom-right", "end", "end"],
	] as const)(
		"translates %s without changing signed offsets or fixed sizes",
		(anchor, horizontal, vertical) => {
			expect(
				createClientHudPanelPlacement(
					{
						anchor,
						offset: { x: -12, y: 23 },
						size: { width: 310, height: 170 },
					},
					{ width: 1000, height: 800 },
					7,
				),
			).toEqual({
				horizontal: { alignment: horizontal, offset: -12 },
				vertical: { alignment: vertical, offset: 23 },
				preferredWidth: 310,
				preferredHeight: 170,
			});
		},
	);

	it.each([
		[200, 3, 150, 120],
		[500, 5, 250, 400],
		[900, 8, 400, 600],
	])(
		"resolves bounded viewport height and per-shortcut width at height %s",
		(height, count, width, expectedHeight) => {
			const placement = createClientHudPanelPlacement(
				{
					anchor: "bottom-left",
					offset: { x: 10, y: 10 },
					size: {
						width: { perShortcut: 50 },
						height: { viewportMinus: 100, min: 120, max: 600 },
					},
				},
				{ width: 1000, height },
				count,
			);
			expect(placement.preferredWidth).toBe(width);
			expect(placement.preferredHeight).toBe(expectedHeight);
		},
	);

	it("keeps an edge-anchored panel inside a shrinking viewport", () => {
		const resolved = resolveClientHudPlacement(
			{
				horizontal: { alignment: "end", offset: 16 },
				vertical: { alignment: "end", offset: 16 },
				preferredWidth: 336,
				preferredHeight: 42,
			},
			{ width: 300, height: 100 },
			{ width: 280, height: 36 },
		);

		expect(resolved).toEqual({ left: 0, top: 42, width: 284, height: 42 });
	});

	it("temporarily relaxes preferred dimensions and restores them when space returns", () => {
		const placement = createClientHudPanelPlacement(
			{
				anchor: "bottom-left",
				offset: { x: 16, y: 16 },
				size: { width: 400, height: 450 },
			},
			{ width: 1344, height: 820 },
			8,
		);
		const compact = resolveClientHudPlacement(
			placement,
			{ width: 360, height: 300 },
			PANEL_MINIMUM,
		);
		const restored = resolveClientHudPlacement(
			placement,
			{ width: 1_344, height: 820 },
			PANEL_MINIMUM,
		);

		expect(compact).toEqual({ left: 16, top: 0, width: 344, height: 284 });
		expect(restored).toEqual({ left: 16, top: 354, width: 400, height: 450 });
	});

	it("captures moved geometry against the nearest edges without changing preference", () => {
		const placement = anchorClientHudPlacement(
			{ left: 700, top: 500, width: 300, height: 200 },
			{ width: 1_024, height: 768 },
			{ width: 400, height: 450 },
		);

		expect(placement).toEqual({
			horizontal: { alignment: "end", offset: 24 },
			vertical: { alignment: "end", offset: 68 },
			preferredWidth: 400,
			preferredHeight: 450,
		});
	});

	it("keeps the radar square against the tighter content axis", () => {
		const resolved = resolveClientHudSquarePlacement(
			{
				horizontal: { alignment: "end", offset: 48 },
				vertical: { alignment: "start", offset: 16 },
				preferredWidth: 220,
				preferredHeight: 220,
			},
			{ width: 180, height: 500 },
			140,
		);

		expect(resolved).toEqual({ left: 0, top: 16, width: 140, height: 140 });
	});

	it("resizes HUD windows from their left and top borders", () => {
		expect(
			resizeClientPanelRectangle(
				{ left: 400, top: 300, width: 330, height: 310 },
				{ width: 1_024, height: 768 },
				{ width: 280, height: 220 },
				{ x: -50, y: 40 },
				{ horizontal: "left", vertical: "top" },
			),
		).toEqual({ left: 350, top: 340, width: 380, height: 270 });
	});

	it("constrains HUD-window border resizing to the viewport and minimum", () => {
		expect(
			resizeClientPanelRectangle(
				{ left: 400, top: 300, width: 330, height: 310 },
				{ width: 800, height: 650 },
				{ width: 280, height: 220 },
				{ x: 500, y: -500 },
				{ horizontal: "right", vertical: "bottom" },
			),
		).toEqual({ left: 400, top: 300, width: 400, height: 220 });
	});

	it.each([
		["start", "start", { left: 24, top: 30 }],
		["center", "start", { left: 436, top: 30 }],
		["end", "start", { left: 800, top: 30 }],
		["start", "center", { left: 24, top: 364 }],
		["center", "center", { left: 436, top: 364 }],
		["end", "center", { left: 800, top: 364 }],
		["start", "end", { left: 24, top: 638 }],
		["center", "end", { left: 436, top: 638 }],
		["end", "end", { left: 800, top: 638 }],
	] as const)("resolves %s/%s anchors", (horizontal, vertical, expected) => {
		const resolved = resolveClientHudPlacement(
			{
				horizontal: { alignment: horizontal, offset: 24 },
				vertical: { alignment: vertical, offset: 30 },
				preferredWidth: 200,
				preferredHeight: 100,
			},
			{ width: 1_024, height: 768 },
			{ width: 100, height: 50 },
		);

		expect({ left: resolved.left, top: resolved.top }).toEqual(expected);
	});

	it("retains signed center offsets through shrink and regrowth", () => {
		const placement = {
			horizontal: { alignment: "center", offset: -40 },
			vertical: { alignment: "center", offset: 30 },
			preferredWidth: 400,
			preferredHeight: 300,
		} as const;

		expect(
			resolveClientHudPlacement(
				placement,
				{ width: 300, height: 220 },
				{ width: 120, height: 100 },
			),
		).toEqual({ left: 0, top: 60, width: 220, height: 160 });
		expect(
			resolveClientHudPlacement(
				placement,
				{ width: 1_024, height: 768 },
				{ width: 120, height: 100 },
			),
		).toEqual({ left: 272, top: 264, width: 400, height: 300 });
	});

	it("captures all three reference points without moving the rectangle", () => {
		const viewport = { width: 1_000, height: 800 };
		const preferred = { width: 200, height: 100 };
		const rectangles = [
			{
				rectangle: { left: 20, top: 30, width: 200, height: 100 },
				horizontal: "start",
				vertical: "start",
			},
			{
				rectangle: { left: 400, top: 350, width: 200, height: 100 },
				horizontal: "center",
				vertical: "center",
			},
			{
				rectangle: { left: 400, top: 30, width: 200, height: 100 },
				horizontal: "center",
				vertical: "start",
			},
			{
				rectangle: { left: 780, top: 350, width: 200, height: 100 },
				horizontal: "end",
				vertical: "center",
			},
			{
				rectangle: { left: 400, top: 670, width: 200, height: 100 },
				horizontal: "center",
				vertical: "end",
			},
			{
				rectangle: { left: 20, top: 350, width: 200, height: 100 },
				horizontal: "start",
				vertical: "center",
			},
			{
				rectangle: { left: 780, top: 670, width: 200, height: 100 },
				horizontal: "end",
				vertical: "end",
			},
		] as const;

		for (const fixture of rectangles) {
			const placement = anchorClientHudPlacement(
				fixture.rectangle,
				viewport,
				preferred,
			);
			expect(placement.horizontal.alignment).toBe(fixture.horizontal);
			expect(placement.vertical.alignment).toBe(fixture.vertical);
			expect(
				resolveClientHudPlacement(placement, viewport, {
					width: 100,
					height: 50,
				}),
			).toEqual(fixture.rectangle);
		}
	});
});
