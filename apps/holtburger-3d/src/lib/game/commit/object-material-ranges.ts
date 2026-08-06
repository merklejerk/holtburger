import { resolveObjectTriangleMaterial } from "./object-material-binding";
import { addAssetTextureFacts } from "../textures/texture-facts";
import type { ResolvedObjectPart } from "../resolution/presentation";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { ObjectMaterialBinding } from "./artifacts";

/** One contiguous authored triangle span sharing a single resolved material binding. */
export interface ObjectMaterialRange {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	/**
	 * Stable identity of the binding that closed this span.
	 *
	 * Consumers key their own batching or draw identity from it; the span itself carries no
	 * renderer or entity identity so it can serve both dynamic templates and the sky.
	 */
	readonly bindingId: string;
}

/**
 * Coalesce an authored part's triangles into contiguous single-material spans.
 *
 * Authored polygon order is material-coherent in practice, so adjacent triangles resolving to the
 * same binding merge into one draw range. Any texture the spans reach is accumulated into
 * `textureRequirements`, which is the caller's residency worklist.
 */
export function resolveObjectMaterialRanges(
	part: ResolvedObjectPart,
	sourceLabel: string,
	textureRequirements: Map<AssetTextureKey, AssetTextureFact>,
): readonly ObjectMaterialRange[] {
	if (part.geometry.indices.length % 3 !== 0) {
		throw new Error(`${sourceLabel} indices are not triangles.`);
	}
	const triangleCount = part.geometry.indices.length / 3;
	if (part.geometry.materialSlotIndices.length !== triangleCount) {
		throw new Error(
			`${sourceLabel} material slots do not cover its triangles.`,
		);
	}
	const ranges: ObjectMaterialRange[] = [];
	for (let triangle = 0; triangle < triangleCount; triangle += 1) {
		const resolved = resolveObjectTriangleMaterial({
			// Detail is a static-scenery and terrain concern selected by the owning render domain;
			// no part-level source has ever carried one.
			detailRole: null,
			geometry: part.geometry,
			materials: part.materials,
			sourceLabel,
			triangle,
		});
		addAssetTextureFacts(
			textureRequirements,
			resolved.textureRequirements,
			sourceLabel,
		);
		const previous = ranges.at(-1);
		if (
			previous?.bindingId === resolved.bindingId &&
			previous.indexStart + previous.indexCount === triangle * 3
		) {
			ranges[ranges.length - 1] = {
				...previous,
				indexCount: previous.indexCount + 3,
			};
			continue;
		}
		ranges.push({
			bindingId: resolved.bindingId,
			indexCount: 3,
			indexStart: triangle * 3,
			material: resolved.binding,
			ordering: resolved.ordering,
		});
	}
	return ranges;
}
