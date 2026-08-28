import { describe, expect, it } from "vitest";

import {
	anchorClientHudPlacement,
	createDefaultClientHudLayout,
	resizeClientPanelRectangle,
	resolveClientHudPlacement,
	resolveClientHudSquarePlacement,
} from "./client-hud-layout";

const PANEL_MINIMUM = { width: 280, height: 240 };

describe("client HUD layout", () => {
	it("anchors the default surfaces to their intended content edges", () => {
		const layout = createDefaultClientHudLayout(1_344, 820, 8);

		expect(layout.character).toMatchObject({
			horizontal: { edge: "left", offset: 16 },
			vertical: { edge: "top", offset: 16 },
		});
		expect(layout.chat).toMatchObject({
			horizontal: { edge: "left", offset: 16 },
			vertical: { edge: "bottom", offset: 16 },
		});
		expect(layout.fps).toEqual({
			horizontal: { edge: "left", offset: 624 },
			vertical: { edge: "top", offset: 8 },
			preferredWidth: 96,
			preferredHeight: 26,
		});
		expect(layout.shortcuts).toMatchObject({
			horizontal: { edge: "right", offset: 16 },
			vertical: { edge: "bottom", offset: 16 },
		});
	});

	it("keeps an edge-anchored panel inside a shrinking viewport", () => {
		const layout = createDefaultClientHudLayout(1_344, 820, 8);
		const resolved = resolveClientHudPlacement(
			layout.shortcuts,
			{ width: 300, height: 100 },
			{ width: 280, height: 36 },
		);

		expect(resolved).toEqual({ left: 0, top: 42, width: 284, height: 42 });
	});

	it("temporarily relaxes preferred dimensions and restores them when space returns", () => {
		const layout = createDefaultClientHudLayout(1_344, 820, 8);
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
			horizontal: { edge: "right", offset: 24 },
			vertical: { edge: "bottom", offset: 68 },
			preferredWidth: 400,
			preferredHeight: 450,
		});
	});

	it("keeps the radar square against the tighter content axis", () => {
		const resolved = resolveClientHudSquarePlacement(
			{
				horizontal: { edge: "right", offset: 48 },
				vertical: { edge: "top", offset: 16 },
				preferredWidth: 220,
				preferredHeight: 220,
			},
			{ width: 180, height: 500 },
			140,
		);

		expect(resolved).toEqual({ left: 0, top: 16, width: 140, height: 140 });
	});

	it("resizes floating panels from their left and top borders", () => {
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

	it("constrains floating-panel border resizing to the viewport and minimum", () => {
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
});
