import { describe, expect, it } from "vitest";
import {
	compilePortalScopeAtlasAttachmentCommands,
	type PortalScopeAtlasAttachmentCommand,
} from "./portal-scope-atlas-command-model";
import {
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
} from "./portal-scope-envelope-depth";
import { PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES } from "./portal-propagation-metadata";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";

describe("portal scope-atlas attachment command model", () => {
	it("uses an implicit root and exact clear/draw calls for nested propagation", () => {
		const plan = compilePortalScopeAtlasAttachmentCommands({
			crossingVertexCount: 18,
			scopeCount: 4,
			traversalDepth: 3,
		});

		expect(plan.trace).toEqual({
			crossingUploadCallCount: 1,
			drawCallCount: 7,
			envelopeClearCallCount: 1,
			framebufferBindCallCount: 8,
			frontierDepthClearCallCount: 3,
			frontierStateClearCallCount: 3,
			metadataUploadCallCount: 1,
			rootFrontierInitializationCallCount: 0,
		});
		expect(plan.commands).toEqual([
			{
				byteLength:
					PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
					4 * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
				kind: "upload-metadata",
			},
			{ kind: "upload-crossings", vertexCount: 18 },
			{ kind: "bind-framebuffer", target: "envelope" },
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
				kind: "clear-envelope-depth",
			},
			...roundCommands(0, "implicit-root", false),
			...roundCommands(1, 0, false),
			...roundCommands(0, 1, true),
			{ kind: "bind-framebuffer", target: "output" },
			{ kind: "draw-resolve", scopeCount: 4 },
		]);
	});

	it("materializes a root-only envelope with one clear and no frontier work", () => {
		const plan = compilePortalScopeAtlasAttachmentCommands({
			crossingVertexCount: 0,
			scopeCount: 1,
			traversalDepth: 0,
		});

		expect(plan.commands).toEqual([
			{
				byteLength:
					PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
					PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
				kind: "upload-metadata",
			},
			{ kind: "bind-framebuffer", target: "envelope" },
			{
				depth: PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
				kind: "clear-envelope-depth",
			},
			{ kind: "bind-framebuffer", target: "output" },
			{ kind: "draw-resolve", scopeCount: 1 },
		]);
		expect(plan.trace).toMatchObject({
			crossingUploadCallCount: 0,
			drawCallCount: 1,
			frontierDepthClearCallCount: 0,
			frontierStateClearCallCount: 0,
			rootFrontierInitializationCallCount: 0,
		});
	});
});

function roundCommands(
	output: 0 | 1,
	current: 0 | 1 | "implicit-root",
	terminal: boolean,
): readonly PortalScopeAtlasAttachmentCommand[] {
	return [
		{ kind: "bind-framebuffer", target: `frontier-${output}` },
		{ kind: "clear-frontier-state", target: output },
		{ depth: 1, kind: "clear-frontier-depth" },
		{
			current,
			kind: "draw-propagation",
			output,
			vertexCount: 18,
		},
		{ kind: "bind-framebuffer", target: "envelope" },
		{
			current,
			kind: "draw-reduction",
			next: output,
			scopeCount: 4,
			terminal,
		},
	];
}
