import { requireWebGL2NoError } from "../webgl/diagnostics";
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
	 * Copy only dirty rows out of the mirror, reallocating first if it has grown.
	 *
	 * Adjacent dirty rows share one texture call; distant births never bridge untouched rows.
	 */
	sync(mirror: Float32Array, dirtyRows: Uint32Array | null): void {
		this.#requireAlive();
		this.#uploadedRowCount = 0;
		const width = this.#recordsPerRow * PARTICLE_RECORD_TEXELS;
		const floatsPerRow = width * FLOATS_PER_TEXEL;
		if (mirror.length % floatsPerRow !== 0)
			throw new Error(
				"Particle record storage must contain complete texture rows.",
			);
		const requiredRows = mirror.length / floatsPerRow;
		const gl = this.#gl;
		if (requiredRows > this.#rows) {
			// Redefining texture storage replaces its contents, so upload every row.
			// Commit the new height only after the driver accepts the allocation.
			requireWebGL2NoError(gl, "Before particle record allocation");
			gl.bindTexture(gl.TEXTURE_2D, this.#texture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA32F,
				width,
				requiredRows,
				0,
				gl.RGBA,
				gl.FLOAT,
				mirror,
				0,
			);
			gl.bindTexture(gl.TEXTURE_2D, null);
			requireWebGL2NoError(gl, "After particle record allocation");
			this.#rows = requiredRows;
			this.#uploadedRowCount = requiredRows;
			return;
		}
		if (dirtyRows === null || this.#rows === 0) return;
		gl.bindTexture(gl.TEXTURE_2D, this.#texture);
		let firstRow = -1;
		let lastRow = -1;
		const upload = (): void => {
			if (firstRow < 0) return;
			const rowCount = lastRow - firstRow + 1;
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
			this.#uploadedRowCount += rowCount;
		};
		for (let wordIndex = 0; wordIndex < dirtyRows.length; wordIndex += 1) {
			let word = dirtyRows[wordIndex] ?? 0;
			while (word !== 0) {
				const bit = 31 - Math.clz32(word & -word);
				const row = wordIndex * 32 + bit;
				if (row >= this.#rows)
					throw new Error(
						`Dirty particle row ${row} exceeds texture height ${this.#rows}.`,
					);
				if (firstRow < 0) firstRow = row;
				else if (row !== lastRow + 1) {
					upload();
					firstRow = row;
				}
				lastRow = row;
				word &= word - 1;
			}
		}
		upload();
		gl.bindTexture(gl.TEXTURE_2D, null);
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
