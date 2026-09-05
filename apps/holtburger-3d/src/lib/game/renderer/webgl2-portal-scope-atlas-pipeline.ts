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
import { WebGL2PortalTileStateApplicator } from "./webgl2-portal-tile-state-applicator";

/** CPU planning state for one camera, valid until the next pipeline frame reset. */
export interface WebGL2PortalScopeAtlasFrame extends SceneScopeSelection {
	/** View-owned selected visibility and packed tile commands. */
	readonly atlas: PortalScopeAtlasFrameView;
	/** View-owned submission diagnostics populated during execution. */
	readonly opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView;
}

class MutableWebGL2PortalScopeAtlasFrame implements WebGL2PortalScopeAtlasFrame {
	/** Independent arenas prevent another camera from overwriting a prepared view. */
	readonly planner = new PortalScopeAtlasPlanner(
		PORTAL_RENDER_CAPACITY_POLICY.culler,
	);
	/** Routing state is local to this view, while device targets remain pipeline-owned. */
	readonly router = new PortalScopeAtlasOpaqueRouter();
	/** CPU staging only; the shared executor uploads this view when it executes. */
	readonly stream = new PortalPropagationStreamArena(
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumCrossingTriangleVertexCount,
	);
	/** Extents are owned by the view because tile coordinates depend on them. */
	readonly resource = {
		atlas: { height: 1, width: 1 },
		drawingBuffer: { height: 1, width: 1 },
		maximumArrivalStateCount:
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		maximumCrossingTriangleVertexCount:
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
				.maximumCrossingTriangleVertexCount,
	} satisfies PortalScopeAtlasResource;
	#atlas: PortalScopeAtlasFrameView | null = null;
	#opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView | null = null;

	get atlas(): PortalScopeAtlasFrameView {
		return this.#require(this.#atlas);
	}

	get count(): number {
		return this.atlas.visibility.selectedScopeCount;
	}

	get opaqueRouting(): PortalScopeAtlasOpaqueRoutingFrameView {
		return this.#require(this.#opaqueRouting);
	}

	scopeAt(ordinal: number): SceneScope {
		return this.atlas.visibility.selectedScope(ordinal);
	}

	set(
		atlas: PortalScopeAtlasFrameView,
		opaqueRouting: PortalScopeAtlasOpaqueRoutingFrameView,
	): void {
		this.#atlas = atlas;
		this.#opaqueRouting = opaqueRouting;
	}

	clear(): void {
		this.#atlas = null;
		this.#opaqueRouting = null;
	}

	#require<T>(value: T | null): T {
		if (value === null) {
			throw new Error("Portal scope-atlas pipeline has no prepared frame.");
		}
		return value;
	}
}

/**
 * Retains independent CPU plans by view ordinal and shares GPU targets/execution across views.
 * All cameras may be prepared first; each must finish rendering before another is activated.
 */
export class WebGL2PortalScopeAtlasPipeline {
	readonly #executor: WebGL2PortalScopeAtlasExecutor;
	readonly #gl: WebGL2RenderingContext;
	readonly #targetOwner: WebGL2PortalScopeAtlasTargets;
	readonly #tileState: WebGL2PortalTileStateApplicator;
	/** High-water CPU plan storage, reused only after explicit frame reset. */
	readonly #views: MutableWebGL2PortalScopeAtlasFrame[] = [];
	/** Number of successfully prepared views in the current frame. */
	#viewCount = 0;
	/** The one view currently using shared GPU resources. */
	#active: {
		readonly frame: MutableWebGL2PortalScopeAtlasFrame;
		readonly targets: WebGL2PortalScopeAtlasTargetSet;
	} | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#tileState = new WebGL2PortalTileStateApplicator(gl);
		this.#targetOwner = new WebGL2PortalScopeAtlasTargets(gl);
		this.#executor = new WebGL2PortalScopeAtlasExecutor(
			gl,
			PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
				.maximumCrossingTriangleVertexCount,
			PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
		);
	}

	/** Expire prior plans while retaining their CPU arena capacity. */
	beginFrame(): void {
		this.#active = null;
		for (const view of this.#views) view.clear();
		this.#viewCount = 0;
	}

	/** Plan and pack one camera without allocating targets or issuing GPU commands. */
	prepare(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
		anchorCoordinates: LandblockCoordinates,
		clipFromAnchor: Mat4,
		drawingBufferWidth: number,
		drawingBufferHeight: number,
	): WebGL2PortalScopeAtlasFrame {
		let frame = this.#views[this.#viewCount];
		if (frame === undefined) {
			frame = new MutableWebGL2PortalScopeAtlasFrame();
			this.#views.push(frame);
		}
		const scopeAtlas = PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas;
		// Replace the cold-sized extent values, keeping all arena-backed output view-local.
		frame.resource.atlas.width = drawingBufferWidth * scopeAtlas.columnCount;
		frame.resource.atlas.height = drawingBufferHeight * scopeAtlas.rowCount;
		frame.resource.drawingBuffer.width = drawingBufferWidth;
		frame.resource.drawingBuffer.height = drawingBufferHeight;
		const atlas = frame.planner.plan(topology, input, frame.resource);
		frame.stream.prepare(atlas, anchorCoordinates, clipFromAnchor);
		frame.set(atlas, frame.router.beginFrame(atlas));
		this.#viewCount += 1;
		return frame;
	}

	/** Bind and clear the complete scope-local color/depth atlas before routed opaque draws. */
	beginOpaqueScene(
		prepared: WebGL2PortalScopeAtlasFrame,
		clearColor: readonly [number, number, number, number],
	): WebGL2PortalScopeAtlasTargetSet {
		const frame = this.#views.find(
			(view, ordinal) => ordinal < this.#viewCount && view === prepared,
		);
		if (frame === undefined)
			throw new Error(
				"Portal view is not prepared by this pipeline in the current frame.",
			);
		this.#active = null;
		const targets = this.#targetOwner.resize(frame.resource);
		this.#active = { frame, targets };
		this.#tileState.beginFrame(frame.atlas);
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.framebuffer);
		gl.viewport(
			0,
			0,
			targets.extents.atlas.width,
			targets.extents.atlas.height,
		);
		gl.disable(gl.BLEND);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.clearDepth(1);
		gl.clearColor(...clearColor);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		return targets;
	}

	/** Route the existing outdoor terrain pass once and bind its packed tile. */
	routeTerrainPass(
		submissionCount: number,
		clipTransform: WebGLUniformLocation,
	): void {
		const ordinal =
			this.#requireFrame().router.routeTerrainPass(submissionCount);
		if (ordinal !== null) this.#bindTile(ordinal, clipTransform, true);
	}

	/** Route exterior-global opaque work, such as celestial sky, to the outdoor tile. */
	routeOutdoorOpaqueSubmission(clipTransform: WebGLUniformLocation): void {
		this.#bindTile(
			this.#requireFrame().atlas.tileOrdinalForRenderScopeKey("outdoor"),
			clipTransform,
			true,
		);
	}

	/** Invalidate only cached opaque tile state after an external atlas consumer changes it. */
	invalidateOpaqueTileState(): void {
		this.#requireFrame();
		this.#tileState.invalidate();
	}

	/** Route one already-formed scope-homogeneous object draw without changing its boundary. */
	routeObjectSubmission(
		renderScopeKey: string,
		clipTransform: WebGLUniformLocation,
		clipTransformInvalidated: boolean,
	): void {
		this.#bindTile(
			this.#requireFrame().router.routeObjectSubmission(renderScopeKey),
			clipTransform,
			clipTransformInvalidated,
		);
	}

	/** Propagate selected arrivals, reduce envelopes, and resolve scope-local opaque color/depth. */
	execute(outputFramebuffer: WebGLFramebuffer | null): void {
		const { frame, targets } = this.#requireActive();
		this.#executor.execute({
			outputExtent: frame.resource.drawingBuffer,
			outputFramebuffer,
			stream: frame.stream,
			targets,
			traversalDepth: frame.atlas.commands.traversalDepth,
		});
	}

	/** Bind the resolved output and one immutable scope-envelope texture for deferred draws. */
	beginDeferredScene(outputFramebuffer: WebGLFramebuffer | null): void {
		const { frame, targets } = this.#requireActive();
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, outputFramebuffer);
		gl.viewport(
			0,
			0,
			frame.resource.drawingBuffer.width,
			frame.resource.drawingBuffer.height,
		);
		const unit = PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth;
		gl.bindSampler(unit, null);
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, targets.envelope.depth);
		gl.activeTexture(gl.TEXTURE0);
	}

	/** Resolve one authored scope to its domain envelope without changing the physical draw. */
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void {
		const ordinal =
			this.#requireFrame().atlas.tileOrdinalForRenderScopeKey(renderScopeKey);
		this.#gl.uniform1ui(uniforms.renderDomain, ordinal);
	}

	getDiagnostics(): WebGL2PortalScopeAtlasTargetDiagnostics {
		return this.#targetOwner.getDiagnostics();
	}

	destroy(): void {
		this.#executor.destroy();
		this.#targetOwner.destroy();
		this.beginFrame();
		this.#views.length = 0;
	}

	#bindTile(
		ordinal: number,
		clipTransform: WebGLUniformLocation,
		clipTransformInvalidated: boolean,
	): void {
		this.#tileState.apply(ordinal, clipTransform, clipTransformInvalidated);
	}

	#requireFrame(): MutableWebGL2PortalScopeAtlasFrame {
		return this.#requireActive().frame;
	}

	#requireActive() {
		if (this.#active === null)
			throw new Error("Portal scope-atlas pipeline has no executing view.");
		return this.#active;
	}
}
