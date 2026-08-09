import {
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
} from "./portal-scope-envelope-depth";
import { PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES } from "./portal-propagation-metadata";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";

type FrontierOrdinal = 0 | 1;
type FrontierSource = FrontierOrdinal | "implicit-root";

/** Shader-independent attachment operations owned by one propagation and resolve sequence. */
export type PortalScopeAtlasAttachmentCommand =
	| { readonly byteLength: number; readonly kind: "upload-metadata" }
	| { readonly kind: "upload-crossings"; readonly vertexCount: number }
	| {
			readonly kind: "bind-framebuffer";
			readonly target: "envelope" | "output" | `frontier-${FrontierOrdinal}`;
	  }
	| { readonly depth: number; readonly kind: "clear-envelope-depth" }
	| {
			readonly kind: "clear-frontier-state";
			readonly target: FrontierOrdinal;
	  }
	| { readonly depth: 1; readonly kind: "clear-frontier-depth" }
	| {
			readonly current: FrontierSource;
			readonly kind: "draw-propagation";
			readonly output: FrontierOrdinal;
			readonly vertexCount: number;
	  }
	| {
			readonly current: FrontierSource;
			readonly kind: "draw-reduction";
			readonly next: FrontierOrdinal;
			readonly scopeCount: number;
			readonly terminal: boolean;
	  }
	| { readonly kind: "draw-resolve"; readonly scopeCount: number };

/** Exact owned CPU calls after existing opaque batches have populated the scope atlas. */
interface PortalScopeAtlasAttachmentCommandTrace {
	readonly crossingUploadCallCount: 0 | 1;
	readonly drawCallCount: number;
	readonly envelopeClearCallCount: 1;
	readonly framebufferBindCallCount: number;
	readonly frontierDepthClearCallCount: number;
	readonly frontierStateClearCallCount: number;
	readonly metadataUploadCallCount: 1;
	/** Root is implicit in round zero, so no frontier initialization command exists. */
	readonly rootFrontierInitializationCallCount: 0;
}

/** Proof-only command sequence plus its exact scalar call ledger. */
export interface PortalScopeAtlasAttachmentCommandPlan {
	readonly commands: readonly PortalScopeAtlasAttachmentCommand[];
	readonly trace: PortalScopeAtlasAttachmentCommandTrace;
}

/**
 * Compile the attachment command order without WebGL or renderer state.
 *
 * The returned records are proof machinery, not a production frame schedule. Production will issue
 * the same fixed loop directly from scalar counts and must not allocate these records per frame.
 */
export function compilePortalScopeAtlasAttachmentCommands(input: {
	readonly crossingVertexCount: number;
	readonly scopeCount: number;
	readonly traversalDepth: number;
}): PortalScopeAtlasAttachmentCommandPlan {
	for (const [name, value, minimum] of [
		["crossing vertex count", input.crossingVertexCount, 0],
		["scope count", input.scopeCount, 1],
		["traversal depth", input.traversalDepth, 0],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(
				`Portal scope-atlas attachment ${name} must be an integer at least ${minimum}.`,
			);
		}
	}
	if ((input.traversalDepth === 0) !== (input.crossingVertexCount === 0)) {
		throw new Error(
			"Portal scope-atlas propagation depth and crossing stream must both be empty or non-empty.",
		);
	}

	const commands: PortalScopeAtlasAttachmentCommand[] = [
		{
			byteLength:
				PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
				input.scopeCount * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
			kind: "upload-metadata",
		},
	];
	if (input.crossingVertexCount > 0) {
		commands.push({
			kind: "upload-crossings",
			vertexCount: input.crossingVertexCount,
		});
	}
	commands.push(
		{ kind: "bind-framebuffer", target: "envelope" },
		{
			depth:
				input.traversalDepth === 0
					? PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH
					: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
			kind: "clear-envelope-depth",
		},
	);
	for (let round = 0; round < input.traversalDepth; round += 1) {
		const output = (round % 2) as FrontierOrdinal;
		const current: FrontierSource =
			round === 0 ? "implicit-root" : (((round - 1) % 2) as FrontierOrdinal);
		commands.push(
			{ kind: "bind-framebuffer", target: `frontier-${output}` },
			{ kind: "clear-frontier-state", target: output },
			{ depth: 1, kind: "clear-frontier-depth" },
			{
				current,
				kind: "draw-propagation",
				output,
				vertexCount: input.crossingVertexCount,
			},
			{ kind: "bind-framebuffer", target: "envelope" },
			{
				current,
				kind: "draw-reduction",
				next: output,
				scopeCount: input.scopeCount,
				terminal: round === input.traversalDepth - 1,
			},
		);
	}
	commands.push(
		{ kind: "bind-framebuffer", target: "output" },
		{ kind: "draw-resolve", scopeCount: input.scopeCount },
	);

	return Object.freeze({
		commands: Object.freeze(commands),
		trace: Object.freeze({
			crossingUploadCallCount: input.crossingVertexCount === 0 ? 0 : 1,
			drawCallCount: input.traversalDepth * 2 + 1,
			envelopeClearCallCount: 1,
			framebufferBindCallCount: input.traversalDepth * 2 + 2,
			frontierDepthClearCallCount: input.traversalDepth,
			frontierStateClearCallCount: input.traversalDepth,
			metadataUploadCallCount: 1,
			rootFrontierInitializationCallCount: 0,
		}),
	});
}
