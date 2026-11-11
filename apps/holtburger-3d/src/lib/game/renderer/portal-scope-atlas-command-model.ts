import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
	PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
} from "./portal-crossing-triangle-stream";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
} from "./portal-scope-envelope-depth";

type FrontierOrdinal = 0 | 1;
type PortalScopeAtlasBuffer =
	"crossing-indices" | "crossings" | "metadata" | "quads";
type PortalScopeAtlasBufferTarget = "array" | "copy-write" | "uniform";
type PortalScopeAtlasDepthComparison =
	"always" | "greater" | "less" | "less-equal";
type PortalScopeAtlasScissorTarget = "packed-atlas" | "root-tile";
type PortalScopeAtlasCapability =
	| "blend"
	| "cull-face"
	| "depth-test"
	| "polygon-offset-fill"
	| "scissor-test"
	| "stencil-test";
type PortalScopeAtlasFramebuffer =
	"envelope" | "output" | `frontier-${FrontierOrdinal}`;
type PortalScopeAtlasProgram =
	| "propagation-root"
	| "propagation-from-0"
	| "propagation-from-1"
	| "reduction"
	| "resolve";
type PortalScopeAtlasTexture =
	| "envelope-depth"
	| "frontier-0-state"
	| "frontier-1-state"
	| "frontier-depth"
	| "scene-color"
	| "scene-depth";
type PortalScopeAtlasVertexArray = "crossings" | "unit-quad";

/** Stable texture units configured into the three portal programs at program construction. */
export const PORTAL_SCOPE_ATLAS_TEXTURE_UNITS = Object.freeze({
	envelopeDepth: 5,
	frontier0: 0,
	frontier1: 1,
	frontierDepth: 3,
	sceneColor: 4,
	sceneDepth: 2,
});

/** Scalar frame facts consumed by both the proof recorder and the concrete WebGL backend. */
export interface PortalScopeAtlasExecutionInput {
	/** Total triangle indices uploaded across all retained propagation rounds. */
	readonly crossingIndexCount: number;
	/** Expanded crossing vertices uploaded once and indexed across rounds. */
	readonly crossingVertexCount: number;
	/** Shader-owned uniform-block binding selected at device construction. */
	readonly metadataBindingPoint: number;
	/** Total instanced reduction and resolve quad records uploaded for this frame. */
	readonly quadInstanceCount: number;
	/** Selected render-domain records populated in the metadata block. */
	readonly renderDomainCount: number;
	/** Quad instance count consumed by the opaque resolve pass. */
	readonly resolveQuadCount: number;
	/** First quad instance index consumed by the opaque resolve pass. */
	readonly resolveQuadOffset: number;
	/** Complete propagation rounds retained by the capacity-bounded planner. */
	readonly traversalDepth: number;
	roundIndexCount(round: number): number;
	roundIndexOffset(round: number): number;
	roundReductionQuadCount(round: number): number;
	roundReductionQuadOffset(round: number): number;
}

/**
 * Allocation-free command sink for the exact scope-atlas execution loop.
 *
 * Every method represents one WebGL entry call. A production implementation owns concrete handles;
 * the proof recorder is the only implementation that materializes command records.
 */
export interface PortalScopeAtlasWebGLSink {
	/** Select one generic buffer binding. */
	bindBuffer(
		target: PortalScopeAtlasBufferTarget,
		buffer: PortalScopeAtlasBuffer | null,
	): void;
	/** Select the metadata buffer at one indexed uniform binding. */
	bindBufferBase(bindingPoint: number, buffer: "metadata"): void;
	/** Upload the selected arena view to the bound generic buffer. */
	bufferSubData(target: PortalScopeAtlasBufferTarget, byteLength: number): void;
	/** Select the active texture unit for the next texture bind. */
	activeTexture(unit: number): void;
	/** Bind one owned two-dimensional texture on the active unit. */
	bindTexture2D(texture: PortalScopeAtlasTexture): void;
	/** Remove inherited sampler policy so owned nearest-filter texture parameters take effect. */
	bindSampler(unit: number, sampler: null): void;
	/** Establish one required boolean fixed-function state. */
	setCapability(capability: PortalScopeAtlasCapability, enabled: boolean): void;
	/** Enable every color channel for integer-state and final color writes. */
	colorMask(write: true): void;
	/** Enable depth writes for propagation, reduction, and resolve. */
	depthMask(write: true): void;
	/** Select one owned or external draw framebuffer. */
	bindFramebuffer(target: PortalScopeAtlasFramebuffer): void;
	/** Select the extent owned by the next clear or draw. */
	viewport(target: "atlas" | "drawing-buffer" | "output"): void;
	/** Restrict envelope clears to packed shelf capacity or the root drawing-buffer tile. */
	scissor(target: PortalScopeAtlasScissorTarget): void;
	/** Restrict frontier clears and propagation rasterization to the round's active screen box. */
	scissorRoundFrontier(round: number): void;
	/** Clear the scissored scope envelope region. */
	clearEnvelopeDepth(depth: number): void;
	/** Clear one scissored integer frontier output. */
	clearFrontierState(target: FrontierOrdinal): void;
	/** Clear the scissored shared nearest-crossing depth. */
	clearFrontierDepth(depth: 1): void;
	/** Select one linked portal program. */
	useProgram(program: PortalScopeAtlasProgram): void;
	/** Upload the retained terminal depth once to reduction. */
	uniformReductionDepth(depth: number): void;
	/** Select current/next frontier parity for one reduction round. */
	uniformReductionRound(round: number): void;
	/** Select the comparison used by the next depth-writing pass. */
	depthFunction(compare: PortalScopeAtlasDepthComparison): void;
	/** Select crossing geometry or the shared unit quad. */
	bindVertexArray(vertexArray: PortalScopeAtlasVertexArray): void;
	/** Point the unit-quad VAO's instanced attributes at `firstInstance` in the bound quad buffer. */
	quadInstanceOffset(firstInstance: number): void;
	/** Submit the round's reachable crossing index slice for one output frontier. */
	drawPropagation(
		output: FrontierOrdinal,
		indexOffset: number,
		indexCount: number,
	): void;
	/** Submit the round's active-aperture reduction quad slice. */
	drawReduction(
		next: FrontierOrdinal,
		instanceCount: number,
		terminal: boolean,
	): void;
	/** Submit the root and active child-gutter quad slice to the external output. */
	drawResolve(instanceCount: number): void;
}

/** One shader-independent WebGL entry call in the scope-atlas execution sequence. */
export type PortalScopeAtlasWebGLCall =
	| {
			readonly buffer: PortalScopeAtlasBuffer | null;
			readonly kind: "bind-buffer";
			readonly target: PortalScopeAtlasBufferTarget;
	  }
	| {
			readonly buffer: "metadata";
			readonly bindingPoint: number;
			readonly kind: "bind-buffer-base";
	  }
	| {
			readonly byteLength: number;
			readonly kind: "buffer-sub-data";
			readonly target: PortalScopeAtlasBufferTarget;
	  }
	| { readonly kind: "active-texture"; readonly unit: number }
	| {
			readonly kind: "bind-texture-2d";
			readonly texture: PortalScopeAtlasTexture;
	  }
	| {
			readonly kind: "bind-sampler";
			readonly sampler: null;
			readonly unit: number;
	  }
	| {
			readonly capability: PortalScopeAtlasCapability;
			readonly enabled: boolean;
			readonly kind: "set-capability";
	  }
	| { readonly kind: "color-mask"; readonly write: true }
	| { readonly kind: "depth-mask"; readonly write: true }
	| {
			readonly kind: "bind-framebuffer";
			readonly target: PortalScopeAtlasFramebuffer;
	  }
	| {
			readonly kind: "viewport";
			readonly target: "atlas" | "drawing-buffer" | "output";
	  }
	| {
			readonly kind: "scissor";
			readonly target: PortalScopeAtlasScissorTarget;
	  }
	| { readonly kind: "scissor-round-frontier"; readonly round: number }
	| { readonly depth: number; readonly kind: "clear-envelope-depth" }
	| { readonly kind: "clear-frontier-state"; readonly target: FrontierOrdinal }
	| { readonly depth: 1; readonly kind: "clear-frontier-depth" }
	| { readonly kind: "use-program"; readonly program: PortalScopeAtlasProgram }
	| { readonly depth: number; readonly kind: "uniform-reduction-depth" }
	| { readonly kind: "uniform-reduction-round"; readonly round: number }
	| {
			readonly compare: PortalScopeAtlasDepthComparison;
			readonly kind: "depth-function";
	  }
	| {
			readonly kind: "bind-vertex-array";
			readonly vertexArray: PortalScopeAtlasVertexArray;
	  }
	| {
			readonly firstInstance: number;
			readonly kind: "quad-instance-offset";
	  }
	| {
			readonly indexCount: number;
			readonly indexOffset: number;
			readonly kind: "draw-propagation";
			readonly output: FrontierOrdinal;
	  }
	| {
			readonly instanceCount: number;
			readonly kind: "draw-reduction";
			readonly next: FrontierOrdinal;
			readonly terminal: boolean;
	  }
	| { readonly instanceCount: number; readonly kind: "draw-resolve" };

/** Exact WebGL entry-call counts derived from one proof-only command sequence. */
interface PortalScopeAtlasWebGLCallTrace {
	/** All frame-time WebGL entries, including uploads, state setup, clears, and draws. */
	readonly totalWebGLCallCount: number;
}

/** Proof-only command sequence plus its exact physical WebGL call ledger. */
export interface PortalScopeAtlasWebGLCallPlan {
	/** Immutable call records created only by the proof recorder. */
	readonly calls: readonly PortalScopeAtlasWebGLCall[];
	/** Non-redundant scalar summary of the recorded sequence. */
	readonly trace: PortalScopeAtlasWebGLCallTrace;
}

/**
 * Compile the exact frame-time WebGL call order after opaque batches populate the scope atlas.
 *
 * Both frontier textures remain on fixed units. Propagation has one sampler and points it only at
 * the frontier opposite its output attachment; reduction may sample both only while the envelope
 * framebuffer is bound. The returned records are proof machinery; the shared executor below does
 * not materialize them for a production sink.
 */
export function compilePortalScopeAtlasWebGLCalls(
	input: PortalScopeAtlasExecutionInput,
): PortalScopeAtlasWebGLCallPlan {
	const calls: PortalScopeAtlasWebGLCall[] = [];
	executePortalScopeAtlasWebGLCalls(createRecordingSink(calls), input);
	return Object.freeze({
		calls: Object.freeze(calls),
		trace: countWebGLCalls(calls),
	});
}

/** Issue the proved sequence without constructing command records or per-round objects. */
export function executePortalScopeAtlasWebGLCalls(
	sink: PortalScopeAtlasWebGLSink,
	input: PortalScopeAtlasExecutionInput,
): void {
	validateExecutionInput(input);
	appendUploads(sink, input);
	appendFixedState(sink);
	appendTextureBindings(sink, input.traversalDepth > 0);
	sink.bindFramebuffer("envelope");
	sink.viewport("atlas");
	if (input.traversalDepth > 0 || input.renderDomainCount > 1) {
		sink.scissor("packed-atlas");
		sink.clearEnvelopeDepth(PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH);
	}
	sink.scissor("root-tile");
	sink.clearEnvelopeDepth(PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH);
	if (input.traversalDepth === 0) {
		sink.setCapability("scissor-test", false);
	}

	for (let round = 0; round < input.traversalDepth; round += 1) {
		const output = (round % 2) as FrontierOrdinal;
		const current = (1 - output) as FrontierOrdinal;
		if (round > 0) sink.setCapability("scissor-test", true);
		sink.bindFramebuffer(output === 0 ? "frontier-0" : "frontier-1");
		sink.viewport("drawing-buffer");
		sink.scissorRoundFrontier(round);
		sink.clearFrontierState(output);
		sink.clearFrontierDepth(1);
		sink.useProgram(propagationProgram(round, current));
		sink.depthFunction("less");
		sink.bindVertexArray("crossings");
		sink.drawPropagation(
			output,
			input.roundIndexOffset(round),
			input.roundIndexCount(round),
		);

		sink.setCapability("scissor-test", false);
		sink.bindFramebuffer("envelope");
		sink.viewport("atlas");
		sink.useProgram("reduction");
		if (round === 0) sink.uniformReductionDepth(input.traversalDepth);
		sink.uniformReductionRound(round);
		sink.depthFunction(round === 0 ? "always" : "greater");
		sink.bindVertexArray("unit-quad");
		sink.quadInstanceOffset(input.roundReductionQuadOffset(round));
		sink.drawReduction(
			output,
			input.roundReductionQuadCount(round),
			round === input.traversalDepth - 1,
		);
	}

	sink.bindFramebuffer("output");
	sink.viewport("output");
	sink.useProgram("resolve");
	// Sky and empty terminal backgrounds intentionally retain the clear depth of one. The envelope
	// rejects every nonterminal scope at that depth, so equality admits exactly the ray's terminal
	// scope without weakening opaque nearest-depth selection.
	sink.depthFunction("less-equal");
	if (input.traversalDepth === 0) sink.bindVertexArray("unit-quad");
	sink.quadInstanceOffset(input.resolveQuadOffset);
	sink.drawResolve(input.resolveQuadCount);
	sink.bindBuffer("array", null);
}

function validateExecutionInput(input: PortalScopeAtlasExecutionInput): void {
	requireNonNegativeInteger(input.crossingVertexCount, "crossing vertex count");
	requireNonNegativeInteger(input.crossingIndexCount, "crossing index count");
	requireNonNegativeInteger(
		input.metadataBindingPoint,
		"metadata binding point",
	);
	requirePositiveInteger(input.quadInstanceCount, "quad instance count");
	requirePositiveInteger(input.renderDomainCount, "render domain count");
	requireNonNegativeInteger(input.resolveQuadOffset, "resolve quad offset");
	requirePositiveInteger(input.resolveQuadCount, "resolve quad count");
	requireNonNegativeInteger(input.traversalDepth, "traversal depth");
	if (input.traversalDepth > PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth) {
		throw new Error("Portal scope-atlas traversal depth exceeds its policy.");
	}
	if (input.renderDomainCount > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT) {
		throw new Error(
			"Portal scope-atlas render domain count exceeds R8UI capacity.",
		);
	}
	if (input.quadInstanceCount > PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT) {
		throw new Error(
			"Portal scope-atlas quad instance count exceeds arena capacity.",
		);
	}
	if (
		input.crossingVertexCount % 3 !== 0 ||
		input.crossingIndexCount % 3 !== 0
	) {
		throw new Error(
			"Portal scope-atlas crossing stream must contain complete triangles.",
		);
	}
	if (
		(input.traversalDepth === 0) !== (input.crossingVertexCount === 0) ||
		(input.traversalDepth === 0) !== (input.crossingIndexCount === 0)
	) {
		throw new Error(
			"Portal scope-atlas propagation depth and crossing stream must both be empty or non-empty.",
		);
	}
	if (input.traversalDepth === 0 && input.resolveQuadCount !== 1) {
		throw new Error(
			"Portal scope-atlas zero-depth execution must resolve only the root quad.",
		);
	}
	let expectedIndexOffset = 0;
	let expectedQuadOffset = 0;
	for (let round = 0; round < input.traversalDepth; round += 1) {
		const indexOffset = input.roundIndexOffset(round);
		const indexCount = input.roundIndexCount(round);
		requirePositiveInteger(indexCount, "round crossing index count");
		if (indexCount % 3 !== 0 || indexOffset !== expectedIndexOffset) {
			throw new Error(
				"Portal scope-atlas round crossing slice is inconsistent.",
			);
		}
		expectedIndexOffset += indexCount;

		const quadOffset = input.roundReductionQuadOffset(round);
		const quadCount = input.roundReductionQuadCount(round);
		requirePositiveInteger(quadCount, "round reduction quad count");
		if (quadOffset !== expectedQuadOffset) {
			throw new Error(
				"Portal scope-atlas round reduction slice is inconsistent.",
			);
		}
		expectedQuadOffset += quadCount;
	}
	if (
		expectedIndexOffset !== input.crossingIndexCount ||
		input.resolveQuadOffset !== expectedQuadOffset ||
		input.resolveQuadOffset + input.resolveQuadCount !== input.quadInstanceCount
	) {
		throw new Error(
			"Portal scope-atlas slice totals disagree with uploaded counts.",
		);
	}
}

function requireNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`Portal scope-atlas ${name} must be an integer at least 0.`,
		);
	}
}

function requirePositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(
			`Portal scope-atlas ${name} must be an integer at least 1.`,
		);
	}
}

function appendUploads(
	sink: PortalScopeAtlasWebGLSink,
	input: PortalScopeAtlasExecutionInput,
): void {
	sink.bindBuffer("uniform", "metadata");
	sink.bufferSubData("uniform", PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES);
	sink.bindBuffer("uniform", null);
	if (input.crossingVertexCount > 0) {
		sink.bindBuffer("copy-write", "crossing-indices");
		sink.bufferSubData(
			"copy-write",
			input.crossingIndexCount * Uint16Array.BYTES_PER_ELEMENT,
		);
		sink.bindBuffer("copy-write", null);
		sink.bindBuffer("array", "crossings");
		sink.bufferSubData(
			"array",
			input.crossingVertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
	}
	sink.bindBuffer("array", "quads");
	sink.bufferSubData(
		"array",
		input.quadInstanceCount * PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
	);
	sink.bindBufferBase(input.metadataBindingPoint, "metadata");
}

function propagationProgram(
	round: number,
	current: FrontierOrdinal,
): PortalScopeAtlasProgram {
	if (round === 0) return "propagation-root";
	return current === 0 ? "propagation-from-0" : "propagation-from-1";
}

function appendFixedState(sink: PortalScopeAtlasWebGLSink): void {
	sink.setCapability("depth-test", true);
	sink.setCapability("blend", false);
	sink.setCapability("cull-face", false);
	sink.setCapability("polygon-offset-fill", false);
	sink.setCapability("scissor-test", true);
	sink.setCapability("stencil-test", false);
	sink.colorMask(true);
	sink.depthMask(true);
}

function appendTextureBindings(
	sink: PortalScopeAtlasWebGLSink,
	hasPropagation: boolean,
): void {
	if (hasPropagation) {
		bindTexture(
			sink,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0,
			"frontier-0-state",
		);
		bindTexture(
			sink,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1,
			"frontier-1-state",
		);
	}
	bindTexture(sink, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth, "scene-depth");
	if (hasPropagation) {
		bindTexture(
			sink,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontierDepth,
			"frontier-depth",
		);
	}
	bindTexture(sink, PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneColor, "scene-color");
	bindTexture(
		sink,
		PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
		"envelope-depth",
	);
}

function bindTexture(
	sink: PortalScopeAtlasWebGLSink,
	unit: number,
	texture: PortalScopeAtlasTexture,
): void {
	sink.bindSampler(unit, null);
	sink.activeTexture(unit);
	sink.bindTexture2D(texture);
}

function createRecordingSink(
	calls: PortalScopeAtlasWebGLCall[],
): PortalScopeAtlasWebGLSink {
	return {
		activeTexture: (unit) => calls.push({ kind: "active-texture", unit }),
		bindBuffer: (target, buffer) =>
			calls.push({ buffer, kind: "bind-buffer", target }),
		bindBufferBase: (bindingPoint, buffer) =>
			calls.push({ bindingPoint, buffer, kind: "bind-buffer-base" }),
		bindFramebuffer: (target) =>
			calls.push({ kind: "bind-framebuffer", target }),
		bindSampler: (unit, sampler) =>
			calls.push({ kind: "bind-sampler", sampler, unit }),
		bindTexture2D: (texture) =>
			calls.push({ kind: "bind-texture-2d", texture }),
		bindVertexArray: (vertexArray) =>
			calls.push({ kind: "bind-vertex-array", vertexArray }),
		bufferSubData: (target, byteLength) =>
			calls.push({ byteLength, kind: "buffer-sub-data", target }),
		clearEnvelopeDepth: (depth) =>
			calls.push({ depth, kind: "clear-envelope-depth" }),
		clearFrontierDepth: (depth) =>
			calls.push({ depth, kind: "clear-frontier-depth" }),
		clearFrontierState: (target) =>
			calls.push({ kind: "clear-frontier-state", target }),
		colorMask: (write) => calls.push({ kind: "color-mask", write }),
		depthFunction: (compare) => calls.push({ compare, kind: "depth-function" }),
		depthMask: (write) => calls.push({ kind: "depth-mask", write }),
		drawPropagation: (output, indexOffset, indexCount) =>
			calls.push({
				indexCount,
				indexOffset,
				kind: "draw-propagation",
				output,
			}),
		drawReduction: (next, instanceCount, terminal) =>
			calls.push({
				instanceCount,
				kind: "draw-reduction",
				next,
				terminal,
			}),
		drawResolve: (instanceCount) =>
			calls.push({ instanceCount, kind: "draw-resolve" }),
		quadInstanceOffset: (firstInstance) =>
			calls.push({ firstInstance, kind: "quad-instance-offset" }),
		scissor: (target) => calls.push({ kind: "scissor", target }),
		scissorRoundFrontier: (round) =>
			calls.push({ kind: "scissor-round-frontier", round }),
		setCapability: (capability, enabled) =>
			calls.push({ capability, enabled, kind: "set-capability" }),
		uniformReductionDepth: (depth) =>
			calls.push({ depth, kind: "uniform-reduction-depth" }),
		uniformReductionRound: (round) =>
			calls.push({ kind: "uniform-reduction-round", round }),
		useProgram: (program) => calls.push({ kind: "use-program", program }),
		viewport: (target) => calls.push({ kind: "viewport", target }),
	};
}

function countWebGLCalls(
	calls: readonly PortalScopeAtlasWebGLCall[],
): PortalScopeAtlasWebGLCallTrace {
	return Object.freeze({
		totalWebGLCallCount: calls.length,
	});
}
