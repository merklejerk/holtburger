import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";
import { PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES } from "./portal-crossing-triangle-stream";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
} from "./portal-scope-envelope-depth";

type FrontierOrdinal = 0 | 1;
type PortalScopeAtlasBuffer = "crossings" | "metadata";
type PortalScopeAtlasBufferTarget = "array" | "uniform";
type PortalScopeAtlasCapability =
	| "blend"
	| "cull-face"
	| "depth-test"
	| "polygon-offset-fill"
	| "scissor-test"
	| "stencil-test";
type PortalScopeAtlasFramebuffer =
	| "envelope"
	| "output"
	| `frontier-${FrontierOrdinal}`;
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
	/** Expanded crossing vertices uploaded and reused by every propagation round. */
	readonly crossingVertexCount: number;
	/** Shader-owned uniform-block binding selected at device construction. */
	readonly metadataBindingPoint: number;
	/** Selected scope records consumed as reduction and resolve instances. */
	readonly scopeCount: number;
	/** Complete propagation rounds retained by the capacity-bounded planner. */
	readonly traversalDepth: number;
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
	/** Clear the complete scope envelope. */
	clearEnvelopeDepth(depth: number): void;
	/** Clear one integer frontier output. */
	clearFrontierState(target: FrontierOrdinal): void;
	/** Clear the shared nearest-crossing depth. */
	clearFrontierDepth(depth: 1): void;
	/** Select one linked portal program. */
	useProgram(program: PortalScopeAtlasProgram): void;
	/** Upload the retained terminal depth once to reduction. */
	uniformReductionDepth(depth: number): void;
	/** Select current/next frontier parity for one reduction round. */
	uniformReductionRound(round: number): void;
	/** Select the comparison used by the next depth-writing pass. */
	depthFunction(compare: "greater" | "less"): void;
	/** Select crossing geometry or the shared unit quad. */
	bindVertexArray(vertexArray: PortalScopeAtlasVertexArray): void;
	/** Submit the crossing stream once for one output frontier. */
	drawPropagation(output: FrontierOrdinal, vertexCount: number): void;
	/** Submit all selected scope envelopes once for one round. */
	drawReduction(
		next: FrontierOrdinal,
		scopeCount: number,
		terminal: boolean,
	): void;
	/** Submit all selected scope tiles once to the external output. */
	drawResolve(scopeCount: number): void;
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
	| { readonly depth: number; readonly kind: "clear-envelope-depth" }
	| { readonly kind: "clear-frontier-state"; readonly target: FrontierOrdinal }
	| { readonly depth: 1; readonly kind: "clear-frontier-depth" }
	| { readonly kind: "use-program"; readonly program: PortalScopeAtlasProgram }
	| { readonly depth: number; readonly kind: "uniform-reduction-depth" }
	| { readonly kind: "uniform-reduction-round"; readonly round: number }
	| { readonly compare: "greater" | "less"; readonly kind: "depth-function" }
	| {
			readonly kind: "bind-vertex-array";
			readonly vertexArray: PortalScopeAtlasVertexArray;
	  }
	| {
			readonly kind: "draw-propagation";
			readonly output: FrontierOrdinal;
			readonly vertexCount: number;
	  }
	| {
			readonly kind: "draw-reduction";
			readonly next: FrontierOrdinal;
			readonly scopeCount: number;
			readonly terminal: boolean;
	  }
	| { readonly kind: "draw-resolve"; readonly scopeCount: number };

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
	sink.clearEnvelopeDepth(
		input.traversalDepth === 0
			? PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH
			: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
	);

	for (let round = 0; round < input.traversalDepth; round += 1) {
		const output = (round % 2) as FrontierOrdinal;
		const current = (1 - output) as FrontierOrdinal;
		sink.bindFramebuffer(output === 0 ? "frontier-0" : "frontier-1");
		sink.viewport("drawing-buffer");
		sink.clearFrontierState(output);
		sink.clearFrontierDepth(1);
		sink.useProgram(propagationProgram(round, current));
		sink.depthFunction("less");
		sink.bindVertexArray("crossings");
		sink.drawPropagation(output, input.crossingVertexCount);

		sink.bindFramebuffer("envelope");
		sink.viewport("atlas");
		sink.useProgram("reduction");
		if (round === 0) sink.uniformReductionDepth(input.traversalDepth);
		sink.uniformReductionRound(round);
		sink.depthFunction("greater");
		sink.bindVertexArray("unit-quad");
		sink.drawReduction(
			output,
			input.scopeCount,
			round === input.traversalDepth - 1,
		);
	}

	sink.bindFramebuffer("output");
	sink.viewport("output");
	sink.useProgram("resolve");
	sink.depthFunction("less");
	if (input.traversalDepth === 0) sink.bindVertexArray("unit-quad");
	sink.drawResolve(input.scopeCount);
}

function validateExecutionInput(input: PortalScopeAtlasExecutionInput): void {
	requireNonNegativeInteger(input.crossingVertexCount, "crossing vertex count");
	requireNonNegativeInteger(
		input.metadataBindingPoint,
		"metadata binding point",
	);
	requirePositiveInteger(input.scopeCount, "scope count");
	requireNonNegativeInteger(input.traversalDepth, "traversal depth");
	if (input.traversalDepth > PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth) {
		throw new Error("Portal scope-atlas traversal depth exceeds its policy.");
	}
	if (input.scopeCount > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT) {
		throw new Error("Portal scope-atlas scope count exceeds R8UI capacity.");
	}
	if (input.crossingVertexCount % 3 !== 0) {
		throw new Error(
			"Portal scope-atlas crossing stream must contain complete triangles.",
		);
	}
	if ((input.traversalDepth === 0) !== (input.crossingVertexCount === 0)) {
		throw new Error(
			"Portal scope-atlas propagation depth and crossing stream must both be empty or non-empty.",
		);
	}
	if (input.traversalDepth === 0 && input.scopeCount !== 1) {
		throw new Error(
			"Portal scope-atlas root-only execution must contain exactly one scope.",
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
		sink.bindBuffer("array", "crossings");
		sink.bufferSubData(
			"array",
			input.crossingVertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		sink.bindBuffer("array", null);
	}
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
	sink.setCapability("scissor-test", false);
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
		drawPropagation: (output, vertexCount) =>
			calls.push({ kind: "draw-propagation", output, vertexCount }),
		drawReduction: (next, scopeCount, terminal) =>
			calls.push({ kind: "draw-reduction", next, scopeCount, terminal }),
		drawResolve: (scopeCount) =>
			calls.push({ kind: "draw-resolve", scopeCount }),
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
