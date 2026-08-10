import { describe, expect, it } from "vitest";
import {
	compilePortalScopeAtlasWebGLCalls,
	PORTAL_SCOPE_ATLAS_TEXTURE_UNITS,
	type PortalScopeAtlasWebGLCall,
} from "./portal-scope-atlas-command-model";
import {
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
} from "./portal-scope-envelope-depth";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";

const METADATA_BINDING_POINT = 3;

describe("portal scope-atlas WebGL call model", () => {
	it("derives the exact frame-time call envelope for nested propagation", () => {
		const plan = compilePortalScopeAtlasWebGLCalls({
			crossingVertexCount: 18,
			metadataBindingPoint: METADATA_BINDING_POINT,
			renderDomainCount: 4,
			traversalDepth: 3,
		});

		expect(plan.trace).toEqual({ totalWebGLCallCount: 87 });
		expect(countCalls(plan.calls, "active-texture")).toBe(6);
		expect(countCalls(plan.calls, "bind-buffer")).toBe(4);
		expect(countCalls(plan.calls, "buffer-sub-data")).toBe(2);
		expect(
			countCalls(
				plan.calls,
				"clear-envelope-depth",
				"clear-frontier-depth",
				"clear-frontier-state",
			),
		).toBe(7);
		expect(
			countCalls(
				plan.calls,
				"draw-propagation",
				"draw-reduction",
				"draw-resolve",
			),
		).toBe(7);
		expect(countCalls(plan.calls, "bind-framebuffer")).toBe(8);
		expect(countCalls(plan.calls, "depth-function", "set-capability")).toBe(13);
		expect(countCalls(plan.calls, "color-mask", "depth-mask")).toBe(2);
		expect(countCalls(plan.calls, "bind-buffer-base")).toBe(1);
		expect(countCalls(plan.calls, "use-program")).toBe(7);
		expect(countCalls(plan.calls, "bind-texture-2d")).toBe(6);
		expect(countCalls(plan.calls, "bind-sampler")).toBe(6);
		expect(
			countCalls(
				plan.calls,
				"uniform-reduction-depth",
				"uniform-reduction-round",
			),
		).toBe(4);
		expect(countCalls(plan.calls, "bind-vertex-array")).toBe(6);
		expect(countCalls(plan.calls, "viewport")).toBe(8);
		expect(plan.calls.filter((call) => call.kind.startsWith("draw-"))).toEqual([
			{ kind: "draw-propagation", output: 0, vertexCount: 18 },
			{
				kind: "draw-reduction",
				next: 0,
				renderDomainCount: 4,
				terminal: false,
			},
			{ kind: "draw-propagation", output: 1, vertexCount: 18 },
			{
				kind: "draw-reduction",
				next: 1,
				renderDomainCount: 4,
				terminal: false,
			},
			{ kind: "draw-propagation", output: 0, vertexCount: 18 },
			{
				kind: "draw-reduction",
				next: 0,
				renderDomainCount: 4,
				terminal: true,
			},
			{ kind: "draw-resolve", renderDomainCount: 4 },
		]);
		expect(plan.calls.filter((call) => call.kind.includes("clear"))).toEqual([
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
				kind: "clear-envelope-depth",
			},
			...frontierClears(0),
			...frontierClears(1),
			...frontierClears(0),
		]);
	});

	it("materializes root-only visibility without frontier resources or work", () => {
		const plan = compilePortalScopeAtlasWebGLCalls({
			crossingVertexCount: 0,
			metadataBindingPoint: METADATA_BINDING_POINT,
			renderDomainCount: 1,
			traversalDepth: 0,
		});

		expect(plan.trace).toEqual({ totalWebGLCallCount: 30 });
		expect(countCalls(plan.calls, "active-texture")).toBe(3);
		expect(countCalls(plan.calls, "bind-buffer")).toBe(2);
		expect(countCalls(plan.calls, "buffer-sub-data")).toBe(1);
		expect(countCalls(plan.calls, "clear-envelope-depth")).toBe(1);
		expect(countCalls(plan.calls, "draw-resolve")).toBe(1);
		expect(countCalls(plan.calls, "bind-framebuffer")).toBe(2);
		expect(countCalls(plan.calls, "depth-function", "set-capability")).toBe(7);
		expect(countCalls(plan.calls, "color-mask", "depth-mask")).toBe(2);
		expect(countCalls(plan.calls, "bind-buffer-base")).toBe(1);
		expect(countCalls(plan.calls, "use-program")).toBe(1);
		expect(countCalls(plan.calls, "bind-texture-2d")).toBe(3);
		expect(countCalls(plan.calls, "bind-sampler")).toBe(3);
		expect(countCalls(plan.calls, "bind-vertex-array")).toBe(1);
		expect(countCalls(plan.calls, "viewport")).toBe(2);
		expect(plan.calls).toContainEqual({
			depth: PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
			kind: "clear-envelope-depth",
		});
		expect(
			plan.calls.filter((call) => call.kind === "bind-texture-2d"),
		).toEqual([
			{ kind: "bind-texture-2d", texture: "scene-depth" },
			{ kind: "bind-texture-2d", texture: "scene-color" },
			{ kind: "bind-texture-2d", texture: "envelope-depth" },
		]);
		expect(plan.calls.filter((call) => call.kind.startsWith("draw-"))).toEqual([
			{ kind: "draw-resolve", renderDomainCount: 1 },
		]);
		expect(plan.calls.filter((call) => call.kind === "depth-function")).toEqual(
			[{ compare: "less-equal", kind: "depth-function" }],
		);
	});

	it("keeps every sampled texture disjoint from the active draw attachments", () => {
		for (
			let traversalDepth = 0;
			traversalDepth <= PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
			traversalDepth += 1
		) {
			const plan = compilePortalScopeAtlasWebGLCalls({
				crossingVertexCount: traversalDepth === 0 ? 0 : 3,
				metadataBindingPoint: METADATA_BINDING_POINT,
				renderDomainCount: traversalDepth + 1,
				traversalDepth,
			});
			expect(
				findFeedback(plan.calls),
				`feedback at traversal depth ${traversalDepth}`,
			).toBeNull();
		}
	});

	it("keeps physical CPU submission affine in retained depth", () => {
		for (
			let traversalDepth = 1;
			traversalDepth <= PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
			traversalDepth += 1
		) {
			const plan = compilePortalScopeAtlasWebGLCalls({
				crossingVertexCount: 3,
				metadataBindingPoint: METADATA_BINDING_POINT,
				renderDomainCount: traversalDepth + 1,
				traversalDepth,
			});

			expect(plan.trace.totalWebGLCallCount).toBe(15 * traversalDepth + 42);
			expect(countCalls(plan.calls, "bind-texture-2d")).toBe(6);
			expect(countCalls(plan.calls, "bind-sampler")).toBe(6);
			expect(countCalls(plan.calls, "buffer-sub-data")).toBe(2);
		}
	});

	it("changes only instance counts when selected render-domain count changes", () => {
		const shallow = compilePortalScopeAtlasWebGLCalls({
			crossingVertexCount: 3,
			metadataBindingPoint: METADATA_BINDING_POINT,
			renderDomainCount: 1,
			traversalDepth: 1,
		});
		const dense = compilePortalScopeAtlasWebGLCalls({
			crossingVertexCount: 3,
			metadataBindingPoint: METADATA_BINDING_POINT,
			renderDomainCount: 255,
			traversalDepth: 1,
		});

		expect(dense.trace).toEqual(shallow.trace);
		expect(dense.calls.map((call) => call.kind)).toEqual(
			shallow.calls.map((call) => call.kind),
		);
		expect(
			dense.calls.filter((call) => call.kind === "buffer-sub-data"),
		).toEqual(shallow.calls.filter((call) => call.kind === "buffer-sub-data"));
		expect(dense.calls).not.toEqual(shallow.calls);
	});

	it.each([
		{
			expected: "metadata binding point",
			input: {
				crossingVertexCount: 0,
				metadataBindingPoint: -1,
				renderDomainCount: 1,
				traversalDepth: 0,
			},
		},
		{
			expected: "render domain count exceeds R8UI capacity",
			input: {
				crossingVertexCount: 0,
				metadataBindingPoint: 0,
				renderDomainCount: 256,
				traversalDepth: 0,
			},
		},
		{
			expected: "traversal depth exceeds its policy",
			input: {
				crossingVertexCount: 3,
				metadataBindingPoint: 0,
				renderDomainCount: 1,
				traversalDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth + 1,
			},
		},
		{
			expected: "complete triangles",
			input: {
				crossingVertexCount: 1,
				metadataBindingPoint: 0,
				renderDomainCount: 1,
				traversalDepth: 1,
			},
		},
		{
			expected: "must both be empty or non-empty",
			input: {
				crossingVertexCount: 0,
				metadataBindingPoint: 0,
				renderDomainCount: 1,
				traversalDepth: 1,
			},
		},
		{
			expected: "root-only execution must contain exactly one render domain",
			input: {
				crossingVertexCount: 0,
				metadataBindingPoint: 0,
				renderDomainCount: 2,
				traversalDepth: 0,
			},
		},
	])("rejects invalid executor input: $expected", ({ expected, input }) => {
		expect(() => compilePortalScopeAtlasWebGLCalls(input)).toThrow(expected);
	});
});

function frontierClears(target: 0 | 1): readonly PortalScopeAtlasWebGLCall[] {
	return [
		{ kind: "clear-frontier-state", target },
		{ depth: 1, kind: "clear-frontier-depth" },
	];
}

function findFeedback(
	calls: readonly PortalScopeAtlasWebGLCall[],
): string | null {
	let activeTextureUnit = -1;
	let framebuffer: Extract<
		PortalScopeAtlasWebGLCall,
		{ readonly kind: "bind-framebuffer" }
	>["target"] = "output";
	let program: Extract<
		PortalScopeAtlasWebGLCall,
		{ readonly kind: "use-program" }
	>["program"] = "resolve";
	const textureByUnit = new Map<number, string>();
	for (const call of calls) {
		switch (call.kind) {
			case "active-texture":
				activeTextureUnit = call.unit;
				break;
			case "bind-framebuffer":
				framebuffer = call.target;
				break;
			case "bind-texture-2d":
				textureByUnit.set(activeTextureUnit, call.texture);
				break;
			case "use-program":
				program = call.program;
				break;
			case "draw-propagation":
			case "draw-reduction":
			case "draw-resolve": {
				const attachments = framebufferAttachments(framebuffer);
				for (const texture of sampledTextures(program, textureByUnit)) {
					if (attachments.has(texture)) return `${program} samples ${texture}`;
				}
				break;
			}
		}
	}
	return null;
}

function framebufferAttachments(framebuffer: string): ReadonlySet<string> {
	if (framebuffer === "frontier-0") {
		return new Set(["frontier-0-state", "frontier-depth"]);
	}
	if (framebuffer === "frontier-1") {
		return new Set(["frontier-1-state", "frontier-depth"]);
	}
	if (framebuffer === "envelope") return new Set(["envelope-depth"]);
	return new Set();
}

function sampledTextures(
	program:
		| "propagation-root"
		| "propagation-from-0"
		| "propagation-from-1"
		| "reduction"
		| "resolve",
	textureByUnit: ReadonlyMap<number, string>,
): readonly string[] {
	if (program.startsWith("propagation")) {
		return [
			...(program === "propagation-root"
				? []
				: [
						requireTexture(
							textureByUnit,
							program === "propagation-from-0"
								? PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0
								: PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1,
						),
					]),
			requireTexture(
				textureByUnit,
				PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth,
			),
		];
	}
	if (program === "reduction") {
		return [
			requireTexture(textureByUnit, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0),
			requireTexture(textureByUnit, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1),
			requireTexture(
				textureByUnit,
				PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontierDepth,
			),
		];
	}
	return [
		requireTexture(textureByUnit, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneColor),
		requireTexture(textureByUnit, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth),
		requireTexture(
			textureByUnit,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
		),
	];
}

function requireTexture(
	textureByUnit: ReadonlyMap<number, string>,
	unit: number,
): string {
	const texture = textureByUnit.get(unit);
	if (!texture) throw new Error(`Test model has no texture on unit ${unit}.`);
	return texture;
}

function countCalls(
	calls: readonly PortalScopeAtlasWebGLCall[],
	...kinds: readonly PortalScopeAtlasWebGLCall["kind"][]
): number {
	let count = 0;
	for (const call of calls) {
		if (kinds.includes(call.kind)) count += 1;
	}
	return count;
}
