import { PARTICLE_RECORD_TEXELS } from "./particle-record-layout";

/** RGBA32F carries four floats per texel. */
const FLOATS_PER_TEXEL = 4;

/**
 * Uploads the emitter runtime's record mirror into the data texture the vertex stage reads.
 *
 * Holds no records of its own: the runtime that writes them at spawn owns the mirror, and this side
 * owns only the device resource and the rows that still need copying. Keeping the mirror outside
 * the renderer is what lets emitter lifetime drive record lifetime without device lifetime in the
 * middle.
 */
export class WebGL2ParticleRecordStore {
	readonly #gl: WebGL2RenderingContext;
	readonly #texture: WebGLTexture;
	/** Records per texture row, fixed so a record never straddles rows. */
	readonly #recordsPerRow: number;
	/** Rows currently allocated in the texture. */
	#rows = 0;
	#destroyed = false;
	#uploadedRowCount = 0;

	constructor(gl: WebGL2RenderingContext, recordsPerRow: number) {
		const texture = gl.createTexture();
		if (!texture) {
			throw new Error("Failed to allocate a particle record texture.");
		}
		this.#gl = gl;
		this.#texture = texture;
		this.#recordsPerRow = recordsPerRow;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		// `texelFetch` never filters, so nearest sampling is the honest declaration and keeps the
		// format clear of the float-filtering extension.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	get texture(): WebGLTexture {
		return this.#texture;
	}

	/** Rows uploaded by the most recent sync, for churn diagnostics. */
	get uploadedRowCount(): number {
		return this.#uploadedRowCount;
	}

	/**
	 * Copy the rows covering `dirtySlots` out of the mirror, reallocating first if it has grown.
	 *
	 * Whole rows rather than exact slots: a texture upload is row-addressed anyway, and spawns are
	 * rare enough per frame that the rounding costs less than tracking sub-row spans would.
	 */
	sync(
		mirror: Float32Array,
		dirtySlots: { readonly first: number; readonly last: number } | null,
	): void {
		this.#requireAlive();
		this.#uploadedRowCount = 0;
		const width = this.#recordsPerRow * PARTICLE_RECORD_TEXELS;
		const requiredRows = Math.ceil(mirror.length / (width * FLOATS_PER_TEXEL));
		const gl = this.#gl;
		if (requiredRows > this.#rows) {
			// A grown mirror is a different texture, so every row is uploaded regardless of what
			// the dirty range claimed.
			this.#rows = requiredRows;
			gl.bindTexture(gl.TEXTURE_2D, this.#texture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA32F,
				width,
				this.#rows,
				0,
				gl.RGBA,
				gl.FLOAT,
				mirror,
				0,
			);
			gl.bindTexture(gl.TEXTURE_2D, null);
			this.#uploadedRowCount = this.#rows;
			return;
		}
		if (dirtySlots === null || this.#rows === 0) return;
		const firstRow = Math.floor(dirtySlots.first / this.#recordsPerRow);
		const lastRow = Math.floor(dirtySlots.last / this.#recordsPerRow);
		const rowCount = lastRow - firstRow + 1;
		gl.bindTexture(gl.TEXTURE_2D, this.#texture);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			firstRow,
			width,
			rowCount,
			gl.RGBA,
			gl.FLOAT,
			mirror,
			firstRow * width * FLOATS_PER_TEXEL,
		);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.#uploadedRowCount = rowCount;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteTexture(this.#texture);
	}

	#requireAlive(): void {
		if (this.#destroyed) {
			throw new Error("Particle record store has been destroyed.");
		}
	}
}
