import {
	recordWebGL2Operation,
	requireWebGL2NoError,
} from "../../webgl/diagnostics";
import type { DynamicLayout } from "../../geometry/dynamic-layout";
import type { DynamicAppearance } from "../../systems/dynamic-appearance";
import { compileDynamicIndexBatches } from "./dynamic-index-batches";
import { compileOpaqueDynamicBatchedSpans } from "./dynamic-batched-ranges";
import { compileOpaqueDynamicDepth } from "./dynamic-depth-preparation";
import {
	createObjectMaterialTable,
	OBJECT_MATERIAL_TEXELS,
} from "./object-material-table";
import {
	compileDynamicPartRangeGroups,
	dynamicObjectPhase,
	type DynamicPartRangeGroups,
	type DynamicRangeAdmission,
	type PreparedObjectSurface,
} from "./object-rendering-policy";

/** Fully opaque range decisions shared by every root using one appearance generation. */
export interface OpaqueDynamicAppearanceVariant {
	/** Dense part array must cover every referenced source selector. */
	readonly requiredPartCount: number;
	readonly admission: DynamicRangeAdmission;
	readonly opaqueSpans: ReturnType<typeof compileOpaqueDynamicBatchedSpans>;
	readonly additiveSpans: ReturnType<typeof compileOpaqueDynamicBatchedSpans>;
	readonly transparentRanges: Extract<
		PreparedDynamicAppearance,
		{ kind: "drawable" }
	>["plan"]["ranges"];
	readonly shadowDepth: ReturnType<typeof compileOpaqueDynamicDepth>;
	readonly selectionDepth: ReturnType<typeof compileOpaqueDynamicDepth>;
}

/** Physical resources and draw plan for one retained appearance, or explicit empty geometry. */
export type PreparedDynamicAppearance = {
	/** Immutable source facts retained across physical index/table rebuilds. */
	readonly rangeGroupsByPart: readonly DynamicPartRangeGroups[];
} & (
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
			/** Normal and retail-hidden decisions, compiled with physical index organization. */
			readonly opaqueVariants: readonly [
				OpaqueDynamicAppearanceVariant,
				OpaqueDynamicAppearanceVariant,
			];
	  }
);

/** Borrow compiled range decisions only when the published part array satisfies their selectors. */
export function selectOpaqueDynamicAppearanceVariant(
	appearance: PreparedDynamicAppearance,
	partCount: number,
	allPartsOpaque: boolean,
	showRetailHiddenGeometry: boolean,
): OpaqueDynamicAppearanceVariant | null {
	if (appearance.kind === "empty" || !allPartsOpaque) return null;
	const variant = appearance.opaqueVariants[showRetailHiddenGeometry ? 1 : 0];
	if (partCount < variant.requiredPartCount)
		throw new Error("Dynamic appearance references a missing part.");
	return variant;
}

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
				resource: this.#compile(
					layout,
					appearance,
					compileDynamicPartRangeGroups(appearance),
				),
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
					resource: this.#compile(
						entry.layout,
						appearance,
						entry.resource.rangeGroupsByPart,
					),
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
				OBJECT_MATERIAL_TEXELS *
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
		rangeGroupsByPart: readonly DynamicPartRangeGroups[],
	): PreparedDynamicAppearance {
		if (appearance.ranges.length === 0)
			return { kind: "empty", rangeGroupsByPart };
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
		const opaqueVariants = compileOpaqueDynamicAppearanceVariants(
			plan,
			rangeGroupsByPart,
		);
		const data = createObjectMaterialTable(surfaces);
		const gl = this.#gl;
		requireWebGL2NoError(gl, "Before dynamic appearance upload");
		recordWebGL2Operation(
			gl,
			`appearance ${layout.key}: ${plan.indices.byteLength} index bytes, ${data.byteLength} material bytes`,
		);
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
				OBJECT_MATERIAL_TEXELS,
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
			requireWebGL2NoError(gl, "After dynamic appearance upload");
			return {
				kind: "drawable",
				table,
				indexBuffer,
				plan,
				opaqueVariants,
				rangeGroupsByPart,
			};
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

/** Compile both retail visibility policies for one appearance generation. */
export function compileOpaqueDynamicAppearanceVariants(
	plan: Extract<PreparedDynamicAppearance, { kind: "drawable" }>["plan"],
	rangeGroupsByPart: readonly DynamicPartRangeGroups[],
): readonly [OpaqueDynamicAppearanceVariant, OpaqueDynamicAppearanceVariant] {
	return [
		compileOpaqueVariant(plan, rangeGroupsByPart, false),
		compileOpaqueVariant(plan, rangeGroupsByPart, true),
	];
}

function compileOpaqueVariant(
	plan: Extract<PreparedDynamicAppearance, { kind: "drawable" }>["plan"],
	rangeGroupsByPart: readonly DynamicPartRangeGroups[],
	showRetailHiddenGeometry: boolean,
): OpaqueDynamicAppearanceVariant {
	let sourceRangeGroupCount = 0;
	let hasMaterialFreeShadowGeometry = false;
	let requiredPartCount = 0;
	for (const groups of rangeGroupsByPart) {
		const summary = showRetailHiddenGeometry
			? groups.includingRetailHidden
			: groups.normallyVisible;
		sourceRangeGroupCount += summary.sourceRangeGroupCount;
		hasMaterialFreeShadowGeometry ||= summary.hasOpaqueGeometry;
		requiredPartCount = Math.max(requiredPartCount, groups.partSelector + 1);
	}
	return {
		requiredPartCount,
		admission: { sourceRangeGroupCount, hasMaterialFreeShadowGeometry },
		opaqueSpans: compileOpaqueDynamicBatchedSpans(
			plan,
			"opaque",
			showRetailHiddenGeometry,
		),
		additiveSpans: compileOpaqueDynamicBatchedSpans(
			plan,
			"additive",
			showRetailHiddenGeometry,
		),
		transparentRanges: plan.ranges.filter(
			(range) =>
				dynamicObjectPhase(
					range.source.ordering,
					1,
					range.source.retailVisibility,
					showRetailHiddenGeometry,
				) === "transparent",
		),
		shadowDepth: compileOpaqueDynamicDepth(
			plan,
			showRetailHiddenGeometry,
			true,
		),
		selectionDepth: compileOpaqueDynamicDepth(
			plan,
			showRetailHiddenGeometry,
			false,
		),
	};
}
