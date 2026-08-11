import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";

const NO_TILE_ORDINAL = -1;

/**
 * Applies packed-tile state without changing physical draw order or boundaries.
 *
 * Viewport state belongs to the framebuffer and survives program switches. Clip-transform state
 * belongs to one linked program, so callers explicitly report when their ordinary program setup
 * overwrote that uniform. The cache never guesses about mutations owned by another renderer pass.
 */
export class WebGL2PortalTileStateApplicator {
	readonly #gl: WebGL2RenderingContext;
	#atlas: PortalScopeAtlasFrameView | null = null;
	#clipTransformLocation: WebGLUniformLocation | null = null;
	#clipTransformTileOrdinal = NO_TILE_ORDINAL;
	#viewportTileOrdinal = NO_TILE_ORDINAL;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Forget inherited device state at the start of one opaque atlas pass. */
	beginFrame(atlas: PortalScopeAtlasFrameView): void {
		this.#atlas = atlas;
		this.#clipTransformLocation = null;
		this.#clipTransformTileOrdinal = NO_TILE_ORDINAL;
		this.#viewportTileOrdinal = NO_TILE_ORDINAL;
	}

	/** Forget viewport and clip state changed by an external atlas consumer. */
	invalidate(): void {
		if (!this.#atlas) {
			throw new Error("Portal tile state has no active atlas frame.");
		}
		this.#clipTransformLocation = null;
		this.#clipTransformTileOrdinal = NO_TILE_ORDINAL;
		this.#viewportTileOrdinal = NO_TILE_ORDINAL;
	}

	/** Apply only tile state that differs from the state proven live on the WebGL context. */
	apply(
		ordinal: number,
		clipTransform: WebGLUniformLocation,
		clipTransformInvalidated: boolean,
	): void {
		const atlas = this.#atlas;
		if (!atlas) {
			throw new Error("Portal tile state has no active atlas frame.");
		}
		if (this.#viewportTileOrdinal !== ordinal) {
			this.#gl.viewport(
				atlas.tileX(ordinal),
				atlas.tileY(ordinal),
				atlas.tileWidth(ordinal),
				atlas.tileHeight(ordinal),
			);
			this.#viewportTileOrdinal = ordinal;
		}
		if (
			clipTransformInvalidated ||
			this.#clipTransformLocation !== clipTransform ||
			this.#clipTransformTileOrdinal !== ordinal
		) {
			this.#gl.uniform4f(
				clipTransform,
				atlas.tileClipScaleX(ordinal),
				atlas.tileClipScaleY(ordinal),
				atlas.tileClipOffsetX(ordinal),
				atlas.tileClipOffsetY(ordinal),
			);
			this.#clipTransformLocation = clipTransform;
			this.#clipTransformTileOrdinal = ordinal;
		}
	}
}
