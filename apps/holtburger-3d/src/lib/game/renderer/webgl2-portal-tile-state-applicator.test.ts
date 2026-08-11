import { describe, expect, it } from "vitest";
import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";
import { WebGL2PortalTileStateApplicator } from "./webgl2-portal-tile-state-applicator";

describe("WebGL2PortalTileStateApplicator", () => {
	it("suppresses only repeated viewport and live-program transform writes", () => {
		const fixture = createFixture();
		const state = new WebGL2PortalTileStateApplicator(fixture.gl);
		state.beginFrame(fixture.atlas);

		state.apply(0, fixture.uniformA, true);
		state.apply(0, fixture.uniformA, false);
		state.apply(0, fixture.uniformB, true);
		state.apply(1, fixture.uniformB, false);
		state.apply(1, fixture.uniformB, true);

		expect(fixture.calls).toEqual([
			"viewport:10:20:100:200",
			"uniform:a:1:2:3:4",
			"uniform:b:1:2:3:4",
			"viewport:30:40:50:60",
			"uniform:b:5:6:7:8",
			"uniform:b:5:6:7:8",
		]);
	});

	it("reapplies complete tile state after a frame reset", () => {
		const fixture = createFixture();
		const state = new WebGL2PortalTileStateApplicator(fixture.gl);

		state.beginFrame(fixture.atlas);
		state.apply(0, fixture.uniformA, true);
		state.beginFrame(fixture.atlas);
		state.apply(0, fixture.uniformA, false);

		expect(fixture.calls.slice(0, 2)).toEqual(fixture.calls.slice(2));
	});

	it("reapplies complete tile state after an external atlas consumer", () => {
		const fixture = createFixture();
		const state = new WebGL2PortalTileStateApplicator(fixture.gl);

		state.beginFrame(fixture.atlas);
		state.apply(0, fixture.uniformA, true);
		state.invalidate();
		state.apply(0, fixture.uniformA, false);

		expect(fixture.calls.slice(0, 2)).toEqual(fixture.calls.slice(2));
	});

	it("fails loudly when routing starts outside an opaque atlas pass", () => {
		const fixture = createFixture();
		const state = new WebGL2PortalTileStateApplicator(fixture.gl);

		expect(() => state.apply(0, fixture.uniformA, false)).toThrow(
			"no active atlas frame",
		);
		expect(() => state.invalidate()).toThrow("no active atlas frame");
	});
});

function createFixture() {
	const calls: string[] = [];
	const uniformA = { name: "a" } as WebGLUniformLocation;
	const uniformB = { name: "b" } as WebGLUniformLocation;
	const uniformName = (uniform: WebGLUniformLocation) =>
		(uniform as unknown as { readonly name: string }).name;
	const gl = {
		uniform4f: (
			uniform: WebGLUniformLocation,
			x: number,
			y: number,
			z: number,
			w: number,
		) => calls.push(`uniform:${uniformName(uniform)}:${x}:${y}:${z}:${w}`),
		viewport: (x: number, y: number, width: number, height: number) =>
			calls.push(`viewport:${x}:${y}:${width}:${height}`),
	} as unknown as WebGL2RenderingContext;
	const values = [
		{
			height: 200,
			offsetX: 3,
			offsetY: 4,
			scaleX: 1,
			scaleY: 2,
			width: 100,
			x: 10,
			y: 20,
		},
		{
			height: 60,
			offsetX: 7,
			offsetY: 8,
			scaleX: 5,
			scaleY: 6,
			width: 50,
			x: 30,
			y: 40,
		},
	];
	const value = (ordinal: number) => {
		const selected = values[ordinal];
		if (!selected) throw new Error(`Missing test tile ${ordinal}.`);
		return selected;
	};
	const atlas = {
		tileClipOffsetX: (ordinal: number) => value(ordinal).offsetX,
		tileClipOffsetY: (ordinal: number) => value(ordinal).offsetY,
		tileClipScaleX: (ordinal: number) => value(ordinal).scaleX,
		tileClipScaleY: (ordinal: number) => value(ordinal).scaleY,
		tileHeight: (ordinal: number) => value(ordinal).height,
		tileWidth: (ordinal: number) => value(ordinal).width,
		tileX: (ordinal: number) => value(ordinal).x,
		tileY: (ordinal: number) => value(ordinal).y,
	} as PortalScopeAtlasFrameView;
	return { atlas, calls, gl, uniformA, uniformB };
}
