import type { LandblockCoordinates } from "../landblocks";
import type { Mat4 } from "../math/types";
import type {
	SceneScope,
	SceneScopeSelection,
	SceneTopologyView,
} from "../scene";
import { PortalPropagationStreamArena } from "./portal-crossing-triangle-stream";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	PortalScopeAtlasOpaqueRouter,
	type PortalScopeAtlasOpaqueRoutingFrameView,
} from "./portal-scope-atlas-opaque-routing";
import {
	PortalScopeAtlasPlanner,
	type PortalScopeAtlasFrameView,
	type PortalScopeAtlasResource,
} from "./portal-scope-atlas-planner";
import type { PortalScopeWindowCullInput } from "./portal-scope-window-culler";
import { PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT } from "./portal-scope-atlas-metadata-glsl";
import type { WebGL2PortalDeferredVisibilityUniforms } from "./portal-deferred-visibility-glsl";
import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import { WebGL2PortalScopeAtlasExecutor } from "./webgl2-portal-scope-atlas-executor";
import {
	WebGL2PortalScopeAtlasTargets,
	type WebGL2PortalScopeAtlasTargetDiagnostics,
	type WebGL2PortalScopeAtlasTargetSet,
} from "./webgl2-portal-scope-atlas-targets";

/** Complete non-retained planning state for the current synchronous portal camera. */
export interface WebGL2PortalScopeAtlasFrame extends SceneScopeSelection {
	readonly atlas: PortalScopeAtlasFrameView;
	readonly opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView;
	readonly targets: WebGL2PortalScopeAtlasTargetSet;
}

class MutableWebGL2PortalScopeAtlasFrame implements WebGL2PortalScopeAtlasFrame {
	#atlas: PortalScopeAtlasFrameView | null = null;
	#opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView | null = null;
	#targets: WebGL2PortalScopeAtlasTargetSet | null = null;

	get atlas(): PortalScopeAtlasFrameView {
		return this.#require(this.#atlas);
	}

	get count(): number {
		return this.atlas.visibility.selectedScopeCount;
	}

	get opaqueRouting(): PortalScopeAtlasOpaqueRoutingFrameView {
		return this.#require(this.#opaqueRouting);
	}

	get targets(): WebGL2PortalScopeAtlasTargetSet {
		return this.#require(this.#targets);
	}

	scopeAt(ordinal: number): SceneScope {
		return this.atlas.visibility.selectedScope(ordinal);
	}

	set(
		atlas: PortalScopeAtlasFrameView,
		opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView,
		targets: WebGL2PortalScopeAtlasTargetSet,
	): void {
		this.#atlas = atlas;
		this.#opaqueRouting = opaqueRouting;
		this.#targets = targets;
	}

	clear(): void {
		this.#atlas = null;
		this.#opaqueRouting = null;
		this.#targets = null;
	}

	#require<T>(value: T | null): T {
		if (value === null) {
			throw new Error("Portal scope-atlas pipeline has no prepared frame.");
		}
		return value;
	}
}

/**
 * Renderer-lifetime owner for the selected portal planner, fixed streams, targets, and executor.
 *
 * The mutable frame wrapper is reused. Callers must query, route, and execute it before preparing
 * another camera; retaining it would make its arena-backed scope and stream views lie.
 */
export class WebGL2PortalScopeAtlasPipeline {
	readonly #atlasExtent = { height: 1, width: 1 };
	readonly #drawingBufferExtent = { height: 1, width: 1 };
	readonly #extents = {
		atlas: this.#atlasExtent,
		drawingBuffer: this.#drawingBufferExtent,
	};
	readonly #executor: WebGL2PortalScopeAtlasExecutor;
	readonly #gl: WebGL2RenderingContext;
	readonly #planner = new PortalScopeAtlasPlanner(
		PORTAL_RENDER_CAPACITY_POLICY.culler,
	);
	readonly #router = new PortalScopeAtlasOpaqueRouter();
	readonly #stream = new PortalPropagationStreamArena(
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumCrossingTriangleVertexCount,
	);
	readonly #targetOwner: WebGL2PortalScopeAtlasTargets;
	readonly #resource: PortalScopeAtlasResource = {
		atlas: this.#atlasExtent,
		drawingBuffer: this.#drawingBufferExtent,
		maximumArrivalStateCount:
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		maximumCrossingTriangleVertexCount:
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
				.maximumCrossingTriangleVertexCount,
	};
	readonly #frame = new MutableWebGL2PortalScopeAtlasFrame();

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#targetOwner = new WebGL2PortalScopeAtlasTargets(
			gl,
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumTargetByteLength,
		);
		this.#executor = new WebGL2PortalScopeAtlasExecutor(
			gl,
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
				.maximumCrossingTriangleVertexCount,
			PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
		);
	}

	/** Plan, pack, and prepare fixed GPU streams for one camera without retaining frame records. */
	prepare(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
		anchorCoordinates: LandblockCoordinates,
		clipFromAnchor: Mat4,
		drawingBufferWidth: number,
		drawingBufferHeight: number,
	): WebGL2PortalScopeAtlasFrame {
		// A failed resize or plan must not leave the previous camera's arena view apparently live.
		this.#frame.clear();
		const scopeAtlas = PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas;
		this.#drawingBufferExtent.width = drawingBufferWidth;
		this.#drawingBufferExtent.height = drawingBufferHeight;
		this.#atlasExtent.width = drawingBufferWidth * scopeAtlas.columnCount;
		this.#atlasExtent.height = drawingBufferHeight * scopeAtlas.rowCount;
		const targets = this.#targetOwner.resize(this.#extents);
		const atlas = this.#planner.plan(topology, input, this.#resource);
		this.#stream.prepare(atlas, anchorCoordinates, clipFromAnchor);
		const opaqueRouting = this.#router.beginFrame(atlas);
		this.#frame.set(atlas, opaqueRouting, targets);
		return this.#frame;
	}

	/** Bind and clear the complete scope-local color/depth atlas before routed opaque draws. */
	beginOpaqueScene(
		clearColor: readonly [number, number, number, number],
	): void {
		const frame = this.#requireFrame();
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frame.targets.scene.framebuffer);
		gl.viewport(
			0,
			0,
			frame.targets.extents.atlas.width,
			frame.targets.extents.atlas.height,
		);
		gl.disable(gl.BLEND);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.clearDepth(1);
		gl.clearColor(...clearColor);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	/** Route the existing outdoor terrain pass once and bind its packed tile. */
	routeTerrainPass(
		submissionCount: number,
		clipTransform: WebGLUniformLocation,
	): void {
		const ordinal = this.#router.routeTerrainPass(submissionCount);
		if (ordinal !== null) this.#bindTile(ordinal, clipTransform);
	}

	/** Route exterior-global opaque work, such as celestial sky, to the outdoor tile. */
	routeOutdoorOpaqueSubmission(clipTransform: WebGLUniformLocation): void {
		this.#bindTile(
			this.#requireFrame().atlas.tileOrdinalForRenderScopeKey("outdoor"),
			clipTransform,
		);
	}

	/** Route one already-formed scope-homogeneous object draw without changing its boundary. */
	routeObjectSubmission(
		renderScopeKey: string,
		clipTransform: WebGLUniformLocation,
	): void {
		this.#bindTile(
			this.#router.routeObjectSubmission(renderScopeKey),
			clipTransform,
		);
	}

	/** Propagate selected arrivals, reduce envelopes, and resolve scope-local opaque color/depth. */
	execute(outputFramebuffer: WebGLFramebuffer | null): void {
		const frame = this.#requireFrame();
		this.#executor.execute({
			outputExtent: this.#drawingBufferExtent,
			outputFramebuffer,
			stream: this.#stream,
			targets: frame.targets,
			traversalDepth: frame.atlas.commands.traversalDepth,
		});
	}

	/** Bind the resolved output and one immutable scope-envelope texture for deferred draws. */
	beginDeferredScene(outputFramebuffer: WebGLFramebuffer | null): void {
		const frame = this.#requireFrame();
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, outputFramebuffer);
		gl.viewport(
			0,
			0,
			this.#drawingBufferExtent.width,
			this.#drawingBufferExtent.height,
		);
		const unit = PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth;
		gl.bindSampler(unit, null);
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, frame.targets.envelope.depth);
		gl.activeTexture(gl.TEXTURE0);
	}

	/** Select one authored scope envelope without changing the caller's physical draw boundary. */
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void {
		const ordinal =
			this.#requireFrame().atlas.tileOrdinalForRenderScopeKey(renderScopeKey);
		this.#gl.uniform1ui(uniforms.scope, ordinal);
	}

	getDiagnostics(): WebGL2PortalScopeAtlasTargetDiagnostics {
		return this.#targetOwner.getDiagnostics();
	}

	destroy(): void {
		this.#executor.destroy();
		this.#targetOwner.destroy();
		this.#frame.clear();
	}

	#bindTile(ordinal: number, clipTransform: WebGLUniformLocation): void {
		const frame = this.#requireFrame();
		const atlas = frame.atlas;
		this.#gl.viewport(
			atlas.tileX(ordinal),
			atlas.tileY(ordinal),
			atlas.tileWidth(ordinal),
			atlas.tileHeight(ordinal),
		);
		this.#gl.uniform4f(
			clipTransform,
			atlas.tileClipScaleX(ordinal),
			atlas.tileClipScaleY(ordinal),
			atlas.tileClipOffsetX(ordinal),
			atlas.tileClipOffsetY(ordinal),
		);
	}

	#requireFrame(): WebGL2PortalScopeAtlasFrame {
		void this.#frame.atlas;
		return this.#frame;
	}
}
