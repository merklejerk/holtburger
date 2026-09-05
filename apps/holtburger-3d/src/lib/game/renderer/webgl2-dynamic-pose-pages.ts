import { writeMat4ToFloat32Array } from "../math/matrices";
import type { ActiveDynamicPart } from "../systems/components";

/** One matrix plus part color/opacity, stored as five RGBA32F texels per row. */
export const DYNAMIC_POSE_TEXELS = 5;
const FLOATS_PER_PART = DYNAMIC_POSE_TEXELS * 4;

/** Draw address shared by every pass selecting the same entity in one frame. */
interface DynamicPoseAddress {
	/** Renderer-owned page containing the complete entity's current part poses. */
	readonly texture: WebGLTexture;
	/** Dense layout part selectors are relative to this first texture row. */
	readonly firstRow: number;
}

/** Reusable page storage; only the populated prefix is uploaded each frame. */
interface PosePage {
	/** Immutable device allocation shared by all entity addresses on this page. */
	readonly texture: WebGLTexture;
	/** Retained matrix/color staging storage matching the page's maximum row capacity. */
	readonly data: Float32Array;
	/** Current populated prefix, reset before packing the next frame. */
	usedRows: number;
}

/** Packs selected entity poses once, then uploads all used pages before any draw reads them. */
export class WebGL2DynamicPosePages<TKey extends string> {
	readonly #gl: WebGL2RenderingContext;
	/** Device texture height bounds each whole-entity allocation, not the total population. */
	readonly #maximumRows: number;
	/** High-water storage reused across frames; shutdown releases every page. */
	readonly #pages: PosePage[] = [];
	/** Only the most recently completed upload publishes addresses to draw consumers. */
	#addresses = new Map<TKey, DynamicPoseAddress>();
	/** Payload transferred by the last completed upload, excluding retained unused page capacity. */
	#uploadedBytes = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#maximumRows = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	}

	/** Each key is selected once across all passes; borrowed part records are consumed synchronously. */
	upload(
		entities: ReadonlyMap<
			TKey,
			readonly Pick<ActiveDynamicPart, "frameInstance">[]
		>,
	): void {
		const addresses = new Map<TKey, DynamicPoseAddress>();
		for (const page of this.#pages) page.usedRows = 0;
		let pageIndex = 0;
		for (const [key, parts] of entities) {
			if (parts.length === 0) continue;
			if (parts.length > this.#maximumRows)
				throw new Error(
					`Dynamic entity ${key} requires ${parts.length} pose rows; device limit is ${this.#maximumRows}.`,
				);
			let page = this.#page(pageIndex);
			if (page.usedRows + parts.length > this.#maximumRows)
				page = this.#page(++pageIndex);
			addresses.set(key, { texture: page.texture, firstRow: page.usedRows });
			let offset = page.usedRows * FLOATS_PER_PART;
			for (const { frameInstance } of parts) {
				writeMat4ToFloat32Array(
					frameInstance.sourceToLandblock,
					page.data,
					offset,
				);
				page.data[offset + 16] = frameInstance.color.r;
				page.data[offset + 17] = frameInstance.color.g;
				page.data[offset + 18] = frameInstance.color.b;
				page.data[offset + 19] = frameInstance.color.a;
				offset += FLOATS_PER_PART;
			}
			page.usedRows += parts.length;
		}
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0);
		let uploadedBytes = 0;
		for (const page of this.#pages) {
			if (page.usedRows === 0) continue;
			gl.bindTexture(gl.TEXTURE_2D, page.texture);
			// The specified rectangle consumes only the populated prefix of the retained array.
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				DYNAMIC_POSE_TEXELS,
				page.usedRows,
				gl.RGBA,
				gl.FLOAT,
				page.data,
			);
			uploadedBytes +=
				page.usedRows * FLOATS_PER_PART * Float32Array.BYTES_PER_ELEMENT;
		}
		this.#addresses = addresses;
		this.#uploadedBytes = uploadedBytes;
	}

	/** A draw cannot silently allocate or upload a missing entity's poses. */
	get(key: TKey): DynamicPoseAddress {
		const address = this.#addresses.get(key);
		if (address === undefined)
			throw new Error(
				`Dynamic entity ${key} was not included in the pose upload.`,
			);
		return address;
	}

	/** Cold GPU capacity and latest upload payload, used together when comparing steady state. */
	getResourceUsage(): { allocatedBytes: number; uploadedBytes: number } {
		return {
			allocatedBytes:
				this.#pages.length *
				this.#maximumRows *
				FLOATS_PER_PART *
				Float32Array.BYTES_PER_ELEMENT,
			uploadedBytes: this.#uploadedBytes,
		};
	}

	destroy(): void {
		for (const page of this.#pages) this.#gl.deleteTexture(page.texture);
		this.#pages.length = 0;
		this.#addresses.clear();
		this.#uploadedBytes = 0;
	}

	#page(index: number): PosePage {
		const existing = this.#pages[index];
		if (existing !== undefined) return existing;
		const gl = this.#gl;
		const texture = gl.createTexture();
		if (texture === null)
			throw new Error("Failed to allocate a dynamic pose page.");
		try {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texStorage2D(
				gl.TEXTURE_2D,
				1,
				gl.RGBA32F,
				DYNAMIC_POSE_TEXELS,
				this.#maximumRows,
			);
			const page = {
				texture,
				data: new Float32Array(this.#maximumRows * FLOATS_PER_PART),
				usedRows: 0,
			};
			this.#pages.push(page);
			return page;
		} catch (cause) {
			gl.deleteTexture(texture);
			throw cause;
		}
	}
}
