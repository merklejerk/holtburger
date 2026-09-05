import type { DynamicLayout } from "../geometry/dynamic-layout";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { compileDynamicIndexBatches } from "./dynamic-index-batches";
import {
	createDynamicMaterialTable,
	DYNAMIC_MATERIAL_TEXELS,
} from "./dynamic-material-table";
import type { PreparedObjectSurface } from "./object-rendering-policy";

/** Physical resources and draw plan for one retained appearance, or explicit empty geometry. */
export type PreparedDynamicAppearance =
	| { readonly kind: "empty" }
	| {
			readonly kind: "drawable";
			/** Shader-readable resolved surface rows. */
			readonly table: WebGLTexture;
			/** Appearance-specific contiguous batches; vertices stay in the shared layout VAO. */
			readonly indexBuffer: WebGLBuffer;
			/** Shared batch state and individual offsets consumed by ordinary and ordered draws. */
			readonly plan: ReturnType<
				typeof compileDynamicIndexBatches<WebGLTexture, WebGLSampler>
			>;
	  };

/** Renderer-supplied material policy and physical atlas resolution. */
type PrepareSurface = (
	material: DynamicAppearance["materials"][number],
	ordering: DynamicAppearance["ranges"][number]["ordering"],
) => PreparedObjectSurface<WebGLTexture, WebGLSampler>;

/** One shared template retention and its current device generation. */
interface AppearanceEntry {
	/** Immutable shared geometry needed when atlas events rebuild appearance index organization. */
	layout: DynamicLayout;
	/** Explicit template retain calls not yet released. */
	references: number;
	/** Current atomic table/index generation. */
	resource: PreparedDynamicAppearance;
}

/** Template-retained GPU appearance storage, rebuilt coherently when atlas bindings change. */
export class WebGL2DynamicAppearances {
	readonly #gl: WebGL2RenderingContext;
	readonly #prepareSurface: PrepareSurface;
	readonly #entries = new Map<DynamicAppearance, AppearanceEntry>();

	constructor(gl: WebGL2RenderingContext, prepareSurface: PrepareSurface) {
		this.#gl = gl;
		this.#prepareSurface = prepareSurface;
	}

	/** Retain one complete appearance after its geometry and atlas requirements are available. */
	retain(layout: DynamicLayout, appearance: DynamicAppearance): () => void {
		let entry = this.#entries.get(appearance);
		if (entry === undefined) {
			entry = {
				layout,
				references: 0,
				resource: this.#compile(layout, appearance),
			};
			this.#entries.set(appearance, entry);
		} else if (entry.layout.key !== layout.key) {
			throw new Error(
				"A retained dynamic appearance cannot change geometry layout.",
			);
		}
		entry.references += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			entry.references -= 1;
			if (entry.references === 0 && this.#entries.get(appearance) === entry) {
				this.#entries.delete(appearance);
				this.#release(entry.resource);
			}
		};
	}

	/** Read only an already-staged resource; drawing must not initiate preparation. */
	get(appearance: DynamicAppearance): PreparedDynamicAppearance {
		const entry = this.#entries.get(appearance);
		if (entry === undefined)
			throw new Error("Dynamic appearance was not retained before drawing.");
		return entry.resource;
	}

	/** Rebuild all retained physical bindings before publishing any replacement resource. */
	rebuild(): void {
		const replacements: {
			entry: AppearanceEntry;
			resource: PreparedDynamicAppearance;
		}[] = [];
		try {
			for (const [appearance, entry] of this.#entries)
				replacements.push({
					entry,
					resource: this.#compile(entry.layout, appearance),
				});
		} catch (cause) {
			for (const replacement of replacements)
				this.#release(replacement.resource);
			throw cause;
		}
		for (const { entry, resource } of replacements) {
			this.#release(entry.resource);
			entry.resource = resource;
		}
	}

	/** Cold GPU payload accounting excludes shared vertices and CPU compilation data. */
	getResourceUsage(): { indexBytes: number; materialBytes: number } {
		let indexBytes = 0;
		let materialBytes = 0;
		for (const [appearance, entry] of this.#entries) {
			if (entry.resource.kind === "empty") continue;
			indexBytes += entry.resource.plan.indices.byteLength;
			materialBytes +=
				appearance.materials.length *
				DYNAMIC_MATERIAL_TEXELS *
				4 *
				Float32Array.BYTES_PER_ELEMENT;
		}
		return { indexBytes, materialBytes };
	}

	/** Final renderer shutdown also retires resources whose template callbacks have not run yet. */
	destroy(): void {
		for (const entry of this.#entries.values()) this.#release(entry.resource);
		this.#entries.clear();
	}

	#compile(
		layout: DynamicLayout,
		appearance: DynamicAppearance,
	): PreparedDynamicAppearance {
		if (appearance.ranges.length === 0) return { kind: "empty" };
		const orderings = new Map(
			appearance.ranges.map((range) => [
				range.materialSelector,
				range.ordering,
			]),
		);
		const surfaces = appearance.materials.map((material, selector) => {
			const ordering = orderings.get(selector);
			if (ordering === undefined)
				throw new Error(
					`Dynamic material selector ${selector} has no source range.`,
				);
			return this.#prepareSurface(material, ordering);
		});
		const plan = compileDynamicIndexBatches(
			layout.geometry.indices,
			appearance,
			surfaces,
		);
		const data = createDynamicMaterialTable(surfaces);
		const gl = this.#gl;
		const table = gl.createTexture();
		const indexBuffer = gl.createBuffer();
		if (table === null || indexBuffer === null) {
			gl.deleteTexture(table);
			gl.deleteBuffer(indexBuffer);
			throw new Error(
				`Failed to allocate dynamic appearance resources for ${layout.key}.`,
			);
		}
		try {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, table);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA32F,
				DYNAMIC_MATERIAL_TEXELS,
				surfaces.length,
				0,
				gl.RGBA,
				gl.FLOAT,
				data,
			);
			// ELEMENT_ARRAY_BUFFER is VAO state. Staging must not mutate a currently bound layout.
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, plan.indices, gl.STATIC_DRAW);
			return { kind: "drawable", table, indexBuffer, plan };
		} catch (cause) {
			gl.deleteTexture(table);
			gl.deleteBuffer(indexBuffer);
			throw cause;
		}
	}

	#release(resource: PreparedDynamicAppearance): void {
		if (resource.kind === "empty") return;
		this.#gl.deleteTexture(resource.table);
		this.#gl.deleteBuffer(resource.indexBuffer);
	}
}
