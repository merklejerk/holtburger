import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { DynamicLayout } from "../geometry/dynamic-layout";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { ResolvedObjectPart } from "../resolution/presentation";
import type { PartVisualTemplate } from "./object-visual-template-repository";
import { Vec3 } from "../math/types";

/** Replaceable appearance facts addressed by the immutable layout's vertex selectors. */
export interface DynamicAppearance {
	/** Dense shader-material inputs; polygon state belongs to ranges, not material records. */
	readonly materials: readonly Omit<ObjectMaterialBinding, "polygon">[];
	/** Authored-order ranges in the merged index buffer, partitioned by actual material/state. */
	readonly ranges: readonly DynamicAppearanceRange[];
}

/** One ordinary indexed range before renderer-owned physical texture batching. */
interface DynamicAppearanceRange {
	/** Existing authored ordering cohort and geometry-local part center; shared by split spans. */
	readonly transparentSort: { readonly key: string; readonly center: Vec3 };
	/** Dense pose selector used to apply part visibility and opacity routing. */
	readonly partSelector: number;
	/** Dense appearance-table address shared with the layout's vertex selector. */
	readonly materialSelector: number;
	/** First merged index, in elements rather than bytes. */
	readonly indexStart: number;
	/** Contiguous index count; accumulated during cold compilation only. */
	indexCount: number;
	/** Authored phase before entity/part effects are applied. */
	readonly ordering: ObjectMaterialOrdering;
	/** Effective culling and retained stippling provenance of this polygon span. */
	readonly polygon: ObjectMaterialBinding["polygon"];
	/** Authored geometry visibility retained independently from appearance phase. */
	readonly retailVisibility: ResolvedObjectPart["retailVisibility"];
}

/** Reuse already-resolved material ranges; never repeat material or polygon policy here. */
export function compileDynamicAppearance(
	layout: DynamicLayout,
	parts: readonly PartVisualTemplate[],
): DynamicAppearance {
	const byPart = new Map(parts.map((part) => [part.partIndex, part]));
	const materials = new Map<number, Omit<ObjectMaterialBinding, "polygon">>();
	const ranges: DynamicAppearanceRange[] = [];
	for (const [partSelector, layoutPart] of layout.parts.entries()) {
		const part = byPart.get(layoutPart.partIndex);
		if (part === undefined)
			throw new Error(
				`Dynamic appearance lacks layout part ${layoutPart.partIndex}.`,
			);
		if (part.drawUnits.length === 0) continue;
		const bounds = part.localBounds;
		if (bounds === null)
			throw new Error(
				`Renderable dynamic part ${part.partIndex} has no local bounds for transparent sorting.`,
			);
		const center = new Vec3(
			(bounds.min.x + bounds.max.x) / 2,
			(bounds.min.y + bounds.max.y) / 2,
			(bounds.min.z + bounds.max.z) / 2,
		);
		for (const unit of part.drawUnits) {
			const transparentSort = {
				key: unit.batchKey,
				center,
			};
			const firstRange = ranges.length;
			const end = layoutPart.indexStart + unit.indexStart + unit.indexCount;
			for (
				let indexStart = layoutPart.indexStart + unit.indexStart;
				indexStart < end;
				indexStart += 3
			) {
				const vertex = layout.geometry.indices[indexStart];
				const selector =
					vertex === undefined
						? undefined
						: layout.geometry.materialSelectors[vertex];
				if (selector === undefined)
					throw new Error(
						`Dynamic appearance range exceeds layout ${layout.key}.`,
					);
				if (!materials.has(selector)) {
					const { polygon, ...material } = unit.material;
					void polygon;
					materials.set(selector, material);
				}
				// Equal resolved bindings can span different authored slots. Keep both selector
				// records even when the old part renderer coalesced those triangles into one draw.
				const current =
					ranges.length === firstRange ? undefined : ranges.at(-1);
				if (current?.materialSelector === selector) {
					current.indexCount += 3;
				} else {
					ranges.push({
						transparentSort,
						partSelector,
						materialSelector: selector,
						indexStart,
						indexCount: 3,
						ordering: unit.ordering,
						polygon: unit.material.polygon,
						retailVisibility: unit.retailVisibility,
					});
				}
			}
		}
	}
	return {
		ranges,
		materials: Array.from(
			{ length: layout.geometry.materialCount },
			(_, selector) => {
				const material = materials.get(selector);
				if (material === undefined)
					throw new Error(
						`Dynamic appearance has no binding for material selector ${selector}.`,
					);
				return material;
			},
		),
	};
}
