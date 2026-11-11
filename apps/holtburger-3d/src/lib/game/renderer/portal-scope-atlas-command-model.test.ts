import { describe, expect, it } from "vitest";
import { PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT } from "./portal-crossing-triangle-stream";
import {
	compilePortalScopeAtlasWebGLCalls,
	PORTAL_SCOPE_ATLAS_TEXTURE_UNITS,
	type PortalScopeAtlasExecutionInput,
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
		const plan = compilePortalScopeAtlasWebGLCalls(
			createExecutionInput({
				crossingIndexCount: 18,
				crossingVertexCount: 18,
				metadataBindingPoint: METADATA_BINDING_POINT,
				quadInstanceCount: 16,
				renderDomainCount: 4,
				resolveQuadCount: 4,
				resolveQuadOffset: 12,
				roundIndexCount: () => 6,
				roundIndexOffset: (round) => round * 6,
				roundReductionQuadCount: () => 4,
				roundReductionQuadOffset: (round) => round * 4,
				traversalDepth: 3,
			}),
		);

		expect(plan.trace).toEqual({ totalWebGLCallCount: 107 });
		expect(countCalls(plan.calls, "active-texture")).toBe(6);
		expect(countCalls(plan.calls, "bind-buffer")).toBe(7);
		expect(countCalls(plan.calls, "buffer-sub-data")).toBe(4);
		expect(
			countCalls(
				plan.calls,
				"clear-envelope-depth",
				"clear-frontier-depth",
				"clear-frontier-state",
			),
		).toBe(8);
		expect(countCalls(plan.calls, "scissor", "scissor-round-frontier")).toBe(5);
		expect(countCalls(plan.calls, "quad-instance-offset")).toBe(4);
		expect(
			countCalls(
				plan.calls,
				"draw-propagation",
				"draw-reduction",
				"draw-resolve",
			),
		).toBe(7);
		expect(countCalls(plan.calls, "bind-framebuffer")).toBe(8);
		expect(countCalls(plan.calls, "depth-function", "set-capability")).toBe(18);
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
			{ indexCount: 6, indexOffset: 0, kind: "draw-propagation", output: 0 },
			{
				instanceCount: 4,
				kind: "draw-reduction",
				next: 0,
				terminal: false,
			},
			{ indexCount: 6, indexOffset: 6, kind: "draw-propagation", output: 1 },
			{
				instanceCount: 4,
				kind: "draw-reduction",
				next: 1,
				terminal: false,
			},
			{ indexCount: 6, indexOffset: 12, kind: "draw-propagation", output: 0 },
			{
				instanceCount: 4,
				kind: "draw-reduction",
				next: 0,
				terminal: true,
			},
			{ instanceCount: 4, kind: "draw-resolve" },
		]);
		expect(plan.calls.filter((call) => call.kind === "depth-function")).toEqual(
			[
				{ compare: "less", kind: "depth-function" },
				{ compare: "always", kind: "depth-function" },
				{ compare: "less", kind: "depth-function" },
				{ compare: "greater", kind: "depth-function" },
				{ compare: "less", kind: "depth-function" },
				{ compare: "greater", kind: "depth-function" },
				{ compare: "less-equal", kind: "depth-function" },
			],
		);
		expect(plan.calls.filter((call) => call.kind.includes("clear"))).toEqual([
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
				kind: "clear-envelope-depth",
			},
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
				kind: "clear-envelope-depth",
			},
			...frontierClears(0),
			...frontierClears(1),
			...frontierClears(0),
		]);
	});

	it("materializes root-only visibility without frontier resources or work", () => {
		const plan = compilePortalScopeAtlasWebGLCalls(
			createExecutionInput({
				crossingIndexCount: 0,
				crossingVertexCount: 0,
				metadataBindingPoint: METADATA_BINDING_POINT,
				quadInstanceCount: 1,
				renderDomainCount: 1,
				resolveQuadCount: 1,
				resolveQuadOffset: 0,
				traversalDepth: 0,
			}),
		);

		expect(plan.trace).toEqual({ totalWebGLCallCount: 36 });
		expect(countCalls(plan.calls, "active-texture")).toBe(3);
		expect(countCalls(plan.calls, "bind-buffer")).toBe(4);
		expect(countCalls(plan.calls, "buffer-sub-data")).toBe(2);
		expect(countCalls(plan.calls, "clear-envelope-depth")).toBe(1);
		expect(countCalls(plan.calls, "scissor")).toBe(1);
		expect(countCalls(plan.calls, "quad-instance-offset")).toBe(1);
		expect(countCalls(plan.calls, "draw-resolve")).toBe(1);
		expect(countCalls(plan.calls, "bind-framebuffer")).toBe(2);
		expect(countCalls(plan.calls, "depth-function", "set-capability")).toBe(8);
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
			{ instanceCount: 1, kind: "draw-resolve" },
		]);
		expect(plan.calls.filter((call) => call.kind === "depth-function")).toEqual(
			[{ compare: "less-equal", kind: "depth-function" }],
		);
	});

	it("clears packed non-root envelope tiles to uncovered depth when zero-depth execution retains child domains", () => {
		const plan = compilePortalScopeAtlasWebGLCalls(
			createExecutionInput({
				crossingIndexCount: 0,
				crossingVertexCount: 0,
				metadataBindingPoint: METADATA_BINDING_POINT,
				quadInstanceCount: 1,
				renderDomainCount: 2,
				resolveQuadCount: 1,
				resolveQuadOffset: 0,
				traversalDepth: 0,
			}),
		);

		expect(plan.trace).toEqual({ totalWebGLCallCount: 38 });
		expect(
			plan.calls.filter(
				(call) =>
					call.kind === "scissor" || call.kind === "clear-envelope-depth",
			),
		).toEqual([
			{ kind: "scissor", target: "packed-atlas" },
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
				kind: "clear-envelope-depth",
			},
			{ kind: "scissor", target: "root-tile" },
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
				kind: "clear-envelope-depth",
			},
		]);
	});

	it("keeps every sampled texture disjoint from the active draw attachments", () => {
		for (
			let traversalDepth = 0;
			traversalDepth <= PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
			traversalDepth += 1
		) {
			const plan = compilePortalScopeAtlasWebGLCalls(
				createDepthInput(traversalDepth, traversalDepth + 1),
			);
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
			const plan = compilePortalScopeAtlasWebGLCalls(
				createDepthInput(traversalDepth, traversalDepth + 1),
			);

			expect(plan.trace.totalWebGLCallCount).toBe(19 * traversalDepth + 50);
			expect(countCalls(plan.calls, "bind-texture-2d")).toBe(6);
			expect(countCalls(plan.calls, "bind-sampler")).toBe(6);
			expect(countCalls(plan.calls, "buffer-sub-data")).toBe(4);
		}
	});

	it("contains no repeated state assignment within executor ownership", () => {
		for (
			let traversalDepth = 0;
			traversalDepth <= PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth;
			traversalDepth += 1
		) {
			const plan = compilePortalScopeAtlasWebGLCalls(
				createDepthInput(traversalDepth, traversalDepth + 1),
			);

			expect(
				findRedundantStateAssignments(plan.calls),
				`redundant state at traversal depth ${traversalDepth}`,
			).toEqual([]);
		}
	});

	it("changes only quad byte length and instance counts when active quad count changes", () => {
		const shallow = compilePortalScopeAtlasWebGLCalls(createDepthInput(1, 1));
		const dense = compilePortalScopeAtlasWebGLCalls(createDepthInput(1, 255));

		expect(dense.trace).toEqual(shallow.trace);
		expect(dense.calls.map((call) => call.kind)).toEqual(
			shallow.calls.map((call) => call.kind),
		);
		expect(dense.calls).not.toEqual(shallow.calls);
	});

	it.each([
		{
			expected: "metadata binding point",
			input: createExecutionInput({
				metadataBindingPoint: -1,
			}),
		},
		{
			expected: "render domain count exceeds R8UI capacity",
			input: createExecutionInput({
				crossingIndexCount: 3,
				crossingVertexCount: 3,
				quadInstanceCount: 2,
				renderDomainCount: 256,
				resolveQuadCount: 1,
				resolveQuadOffset: 1,
				traversalDepth: 1,
			}),
		},
		{
			expected: "quad instance count exceeds arena capacity",
			input: createExecutionInput({
				crossingIndexCount: 3,
				crossingVertexCount: 3,
				quadInstanceCount: PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT + 1,
				renderDomainCount: 2,
				resolveQuadCount: 1,
				resolveQuadOffset: PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
				roundReductionQuadCount: () => PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
				traversalDepth: 1,
			}),
		},
		{
			expected: "traversal depth exceeds its policy",
			input: createExecutionInput({
				crossingIndexCount: 3,
				crossingVertexCount: 3,
				renderDomainCount: 1,
				traversalDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth + 1,
			}),
		},
		{
			expected: "complete triangles",
			input: createExecutionInput({
				crossingIndexCount: 3,
				crossingVertexCount: 1,
				quadInstanceCount: 2,
				renderDomainCount: 1,
				resolveQuadCount: 1,
				resolveQuadOffset: 1,
				traversalDepth: 1,
			}),
		},
		{
			expected: "must both be empty or non-empty",
			input: createExecutionInput({
				crossingIndexCount: 0,
				crossingVertexCount: 0,
				quadInstanceCount: 2,
				renderDomainCount: 1,
				resolveQuadCount: 1,
				resolveQuadOffset: 1,
				traversalDepth: 1,
			}),
		},
		{
			expected: "zero-depth execution must resolve only the root quad",
			input: createExecutionInput({
				quadInstanceCount: 2,
				renderDomainCount: 2,
				resolveQuadCount: 2,
			}),
		},
		{
			expected: "round crossing slice is inconsistent",
			input: createExecutionInput({
				crossingIndexCount: 6,
				crossingVertexCount: 6,
				quadInstanceCount: 3,
				renderDomainCount: 2,
				resolveQuadCount: 1,
				resolveQuadOffset: 2,
				roundIndexCount: () => 3,
				roundIndexOffset: () => 0,
				roundReductionQuadCount: () => 1,
				roundReductionQuadOffset: (round) => round,
				traversalDepth: 2,
			}),
		},
		{
			expected: "round reduction slice is inconsistent",
			input: createExecutionInput({
				crossingIndexCount: 6,
				crossingVertexCount: 6,
				quadInstanceCount: 3,
				renderDomainCount: 2,
				resolveQuadCount: 1,
				resolveQuadOffset: 2,
				roundIndexCount: () => 3,
				roundIndexOffset: (round) => round * 3,
				roundReductionQuadCount: () => 1,
				roundReductionQuadOffset: () => 0,
				traversalDepth: 2,
			}),
		},
		{
			expected: "slice totals disagree with uploaded counts",
			input: createExecutionInput({
				crossingIndexCount: 3,
				crossingVertexCount: 3,
				quadInstanceCount: 5,
				renderDomainCount: 2,
				resolveQuadCount: 1,
				resolveQuadOffset: 1,
				traversalDepth: 1,
			}),
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

/** Identify device-state writes whose value is already live inside the closed command sequence. */
function findRedundantStateAssignments(
	calls: readonly PortalScopeAtlasWebGLCall[],
): readonly PortalScopeAtlasWebGLCall[] {
	let activeTextureUnit = -1;
	const valueByState = new Map<string, string>();
	const redundant: PortalScopeAtlasWebGLCall[] = [];
	const assign = (
		state: string,
		value: string,
		call: PortalScopeAtlasWebGLCall,
	): void => {
		if (valueByState.get(state) === value) redundant.push(call);
		valueByState.set(state, value);
	};
	for (const call of calls) {
		switch (call.kind) {
			case "active-texture":
				assign("active-texture", String(call.unit), call);
				activeTextureUnit = call.unit;
				break;
			case "bind-buffer":
				assign(`buffer:${call.target}`, String(call.buffer), call);
				break;
			case "bind-buffer-base":
				assign(`buffer-base:${call.bindingPoint}`, call.buffer, call);
				break;
			case "bind-framebuffer":
				assign("framebuffer", call.target, call);
				break;
			case "bind-sampler":
				assign(`sampler:${call.unit}`, "null", call);
				break;
			case "bind-texture-2d":
				assign(`texture:${activeTextureUnit}`, call.texture, call);
				break;
			case "bind-vertex-array":
				assign("vertex-array", call.vertexArray, call);
				break;
			case "color-mask":
				assign("color-mask", String(call.write), call);
				break;
			case "depth-function":
				assign("depth-function", call.compare, call);
				break;
			case "depth-mask":
				assign("depth-mask", String(call.write), call);
				break;
			case "quad-instance-offset":
				assign("quad-instance-offset", String(call.firstInstance), call);
				break;
			case "scissor":
				assign("scissor", call.target, call);
				break;
			case "scissor-round-frontier":
				assign("scissor", `round-${call.round}`, call);
				break;
			case "set-capability":
				assign(`capability:${call.capability}`, String(call.enabled), call);
				break;
			case "uniform-reduction-depth":
				assign("uniform-reduction-depth", String(call.depth), call);
				break;
			case "uniform-reduction-round":
				assign("uniform-reduction-round", String(call.round), call);
				break;
			case "use-program":
				assign("program", call.program, call);
				break;
			case "viewport":
				assign("viewport", call.target, call);
				break;
		}
	}
	return redundant;
}

function createExecutionInput(
	overrides: Partial<PortalScopeAtlasExecutionInput>,
): PortalScopeAtlasExecutionInput {
	const traversalDepth = overrides.traversalDepth ?? 0;
	return {
		crossingIndexCount: traversalDepth * 3,
		crossingVertexCount: traversalDepth * 3,
		metadataBindingPoint: METADATA_BINDING_POINT,
		quadInstanceCount: traversalDepth + 1,
		renderDomainCount: traversalDepth === 0 ? 1 : 2,
		resolveQuadCount: 1,
		resolveQuadOffset: traversalDepth,
		roundIndexCount: () => 3,
		roundIndexOffset: (round) => round * 3,
		roundReductionQuadCount: () => 1,
		roundReductionQuadOffset: (round) => round,
		traversalDepth,
		...overrides,
	};
}

function createDepthInput(
	traversalDepth: number,
	quadPerStage: number,
): PortalScopeAtlasExecutionInput {
	if (traversalDepth === 0) {
		return createExecutionInput({
			crossingIndexCount: 0,
			crossingVertexCount: 0,
			quadInstanceCount: quadPerStage,
			renderDomainCount: 1,
			resolveQuadCount: quadPerStage,
			resolveQuadOffset: 0,
			traversalDepth: 0,
		});
	}
	return createExecutionInput({
		crossingIndexCount: traversalDepth * 6,
		crossingVertexCount: 6,
		quadInstanceCount: (traversalDepth + 1) * quadPerStage,
		renderDomainCount: 2,
		resolveQuadCount: quadPerStage,
		resolveQuadOffset: traversalDepth * quadPerStage,
		roundIndexCount: () => 6,
		roundIndexOffset: (round) => round * 6,
		roundReductionQuadCount: () => quadPerStage,
		roundReductionQuadOffset: (round) => round * quadPerStage,
		traversalDepth,
	});
}
