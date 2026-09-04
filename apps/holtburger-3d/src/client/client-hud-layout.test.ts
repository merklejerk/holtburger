import { describe, expect, it } from "vitest";

import {
	anchorClientHudPlacement,
	CLIENT_FPS_PANEL_SIZE,
	CLIENT_SELECTED_ENTITY_PANEL_SIZE,
	createDefaultClientHudLayout,
	resizeClientPanelRectangle,
	resolveClientHudPlacement,
	resolveClientHudSquarePlacement,
} from "./client-hud-layout";

const PANEL_MINIMUM = { width: 280, height: 240 };

describe("client HUD layout", () => {
	it("anchors the default surfaces to their intended content edges", () => {
		const layout = createDefaultClientHudLayout(
			{ width: 1_344, height: 820 },
			8,
		);

		expect(layout.character).toMatchObject({
			horizontal: { alignment: "start", offset: 16 },
			vertical: { alignment: "start", offset: 16 },
		});
		expect(layout.chat).toMatchObject({
			horizontal: { alignment: "start", offset: 16 },
			vertical: { alignment: "end", offset: 16 },
		});
		expect(layout.frameRate).toEqual({
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "start", offset: 8 },
			preferredWidth: CLIENT_FPS_PANEL_SIZE.width,
			preferredHeight: CLIENT_FPS_PANEL_SIZE.height,
		});
		expect(layout.shortcuts).toMatchObject({
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "end", offset: 16 },
		});
		expect(layout.selectedEntity).toEqual({
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "start", offset: 42 },
			preferredWidth: CLIENT_SELECTED_ENTITY_PANEL_SIZE.width,
			preferredHeight: CLIENT_SELECTED_ENTITY_PANEL_SIZE.height,
		});
		expect(layout.minimap).toMatchObject({
			horizontal: { alignment: "end", offset: 48 },
			vertical: { alignment: "start", offset: 16 },
		});
		expect(layout.toast).toMatchObject({
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "end", offset: 48 },
		});
		expect(layout.jumpPower).toMatchObject({
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "end", offset: 72 },
		});
		expect(layout.diagnostics).toMatchObject({
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "start", offset: 260 },
		});
	});

	it("keeps an edge-anchored panel inside a shrinking viewport", () => {
		const layout = createDefaultClientHudLayout(
			{ width: 1_344, height: 820 },
			8,
		);
		const resolved = resolveClientHudPlacement(
			layout.shortcuts,
			{ width: 300, height: 100 },
			{ width: 280, height: 36 },
		);

		expect(resolved).toEqual({ left: 0, top: 42, width: 284, height: 42 });
	});

	it("temporarily relaxes preferred dimensions and restores them when space returns", () => {
		const layout = createDefaultClientHudLayout(
			{ width: 1_344, height: 820 },
			8,
		);
		const compact = resolveClientHudPlacement(
			layout.chat,
			{ width: 360, height: 300 },
			PANEL_MINIMUM,
		);
		const restored = resolveClientHudPlacement(
			layout.chat,
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
