import { describe, expect, it } from "vitest";
import { CLIENT_UI_LAYERS } from "./client-ui-layers";
import { bringWindowToFront, windowZIndex } from "./client-window-stack";

describe("client-window-stack", () => {
	describe("bringWindowToFront", () => {
		it("appends to an empty order", () => {
			const order = bringWindowToFront([], "worldContainer");
			expect(order).toEqual(["worldContainer"]);
		});

		it("appends a new window to the top of an existing stack", () => {
			const order = bringWindowToFront(["worldContainer"], "inspection");
			expect(order).toEqual(["worldContainer", "inspection"]);
		});

		it("moves a window from the bottom or middle to the top", () => {
			const initial = ["worldContainer", "inspection", "inventory"];
			const next = bringWindowToFront(initial, "worldContainer");
			expect(next).toEqual(["inspection", "inventory", "worldContainer"]);

			const middle = bringWindowToFront(next, "inventory");
			expect(middle).toEqual(["inspection", "worldContainer", "inventory"]);
		});

		it("returns the exact same array reference if the window is already at the top", () => {
			const initial = ["worldContainer", "inspection"];
			const next = bringWindowToFront(initial, "inspection");
			expect(next).toBe(initial);
		});
	});

	describe("windowZIndex", () => {
		it("resolves z-index based on stack index above the base layer", () => {
			const order = ["worldContainer", "inspection", "inventory"];
			expect(windowZIndex(order, "worldContainer")).toBe(
				CLIENT_UI_LAYERS.windowBase + 0,
			);
			expect(windowZIndex(order, "inspection")).toBe(
				CLIENT_UI_LAYERS.windowBase + 1,
			);
			expect(windowZIndex(order, "inventory")).toBe(
				CLIENT_UI_LAYERS.windowBase + 2,
			);
		});

		it("assigns unlisted windows the highest position at base + length", () => {
			const order = ["worldContainer", "inspection"];
			expect(windowZIndex(order, "inventory")).toBe(
				CLIENT_UI_LAYERS.windowBase + 2,
			);
		});

		it("respects custom baseZIndex", () => {
			const order = ["worldContainer", "inspection"];
			expect(windowZIndex(order, "worldContainer", 200)).toBe(200);
			expect(windowZIndex(order, "inspection", 200)).toBe(201);
		});
	});
});
