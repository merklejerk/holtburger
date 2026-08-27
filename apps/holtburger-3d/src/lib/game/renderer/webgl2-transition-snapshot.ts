import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";
import { type RenderExtent, validateRenderExtent } from "./render-extent";

const SNAPSHOT_BYTES_PER_PIXEL = 4;

/** Renderer-owned outgoing color snapshot used only while a portal transition is active. */
export interface WebGL2TransitionSnapshotSet {
	readonly extent: RenderExtent;
	readonly texture: WebGLTexture;
}

/** Lifecycle accounting for the transient outgoing transition attachment. */
export interface WebGL2TransitionSnapshotDiagnostics {
	readonly activeBytes: number;
	readonly allocatedGenerationCount: number;
	readonly disposedGenerationCount: number;
	readonly extent: RenderExtent | null;
}

/**
 * Captures one finished flat-scene color target without retaining depth.
 *
 * The snapshot is deliberately separate from {@link WebGL2FlatSceneTarget}: it is allocated only
 * for a transition and released as soon as the compositor no longer needs outgoing pixels. Its
 * native extent is retained across a drawing-buffer resize because the fullscreen compositor
 * samples normalized UVs; no scene node or world resource owns this texture.
 */
export class WebGL2TransitionSnapshot {
	readonly #gl: WebGL2RenderingContext;
	#target: WebGL2TransitionSnapshotSet | null = null;
	#allocatedGenerationCount = 0;
	#disposedGenerationCount = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Capture the complete source framebuffer at exact drawing-buffer dimensions. */
	capture(
		sourceFramebuffer: WebGLFramebuffer,
		extent: RenderExtent,
	): WebGL2TransitionSnapshotSet {
		this.#assertAlive();
		validateRenderExtent(extent, "Transition snapshot");
		const current = this.#target;
		if (
			current === null ||
			current.extent.width !== extent.width ||
			current.extent.height !== extent.height
		) {
			this.#replace(extent);
		}
		const target = this.#target;
		if (target === null) {
			throw new Error("Transition snapshot allocation produced no target.");
		}
		const gl = this.#gl;
		withPreservedWebGL2AllocationBindings(gl, () => {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
			gl.bindTexture(gl.TEXTURE_2D, target.texture);
			gl.copyTexSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				0,
				0,
				extent.width,
				extent.height,
			);
		});
		return target;
	}

	/** Release the current snapshot before the next transition or owner teardown. */
	clear(): void {
		if (this.#target === null) return;
		this.#dispose(this.#target);
		this.#target = null;
	}

	getDiagnostics(): WebGL2TransitionSnapshotDiagnostics {
		const extent = this.#target?.extent ?? null;
		return {
			activeBytes: extent ? transitionSnapshotByteLength(extent) : 0,
			allocatedGenerationCount: this.#allocatedGenerationCount,
			disposedGenerationCount: this.#disposedGenerationCount,
			extent: extent ? { ...extent } : null,
		};
	}

	/** Current captured texture for the final presenter; null before capture or after clear. */
	getCurrentTarget(): WebGL2TransitionSnapshotSet | null {
		return this.#target;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.clear();
	}

	#replace(extent: RenderExtent): void {
		this.#assertAlive();
		const replacement = withPreservedWebGL2AllocationBindings(this.#gl, () => {
			const texture = this.#gl.createTexture();
			if (!texture)
				throw new Error("Failed to allocate transition snapshot texture.");
			try {
				this.#gl.bindTexture(this.#gl.TEXTURE_2D, texture);
				this.#gl.texParameteri(
					this.#gl.TEXTURE_2D,
					this.#gl.TEXTURE_MIN_FILTER,
					this.#gl.NEAREST,
				);
				this.#gl.texParameteri(
					this.#gl.TEXTURE_2D,
					this.#gl.TEXTURE_MAG_FILTER,
					this.#gl.NEAREST,
				);
				this.#gl.texParameteri(
					this.#gl.TEXTURE_2D,
					this.#gl.TEXTURE_WRAP_S,
					this.#gl.CLAMP_TO_EDGE,
				);
				this.#gl.texParameteri(
					this.#gl.TEXTURE_2D,
					this.#gl.TEXTURE_WRAP_T,
					this.#gl.CLAMP_TO_EDGE,
				);
				this.#gl.texImage2D(
					this.#gl.TEXTURE_2D,
					0,
					this.#gl.RGBA8,
					extent.width,
					extent.height,
					0,
					this.#gl.RGBA,
					this.#gl.UNSIGNED_BYTE,
					null,
				);
				return { extent: { ...extent }, texture };
			} catch (cause) {
				this.#gl.deleteTexture(texture);
				throw cause;
			}
		});
		const previous = this.#target;
		this.#target = replacement;
		this.#allocatedGenerationCount += 1;
		if (previous !== null) this.#dispose(previous);
	}

	#dispose(target: WebGL2TransitionSnapshotSet): void {
		this.#gl.deleteTexture(target.texture);
		this.#disposedGenerationCount += 1;
	}

	#assertAlive(): void {
		if (this.#destroyed)
			throw new Error("Transition snapshot has been destroyed.");
	}
}

function transitionSnapshotByteLength(extent: RenderExtent): number {
	validateRenderExtent(extent, "Transition snapshot");
	const bytes = extent.width * extent.height * SNAPSHOT_BYTES_PER_PIXEL;
	if (!Number.isSafeInteger(bytes)) {
		throw new Error("Transition snapshot byte length exceeds safe integers.");
	}
	return bytes;
}
