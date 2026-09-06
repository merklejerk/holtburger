import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../resolution/presentation";
import {
	staticObjectTableStateEquals,
	type PreparedStaticObjectDrawCompatibility,
} from "./object-rendering-policy";

/** Cold range facts belonging to one publication, placement and render scope. */
interface StaticMaterialRange<TGeometry, TTexture, TSampler> {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly ordering: ObjectMaterialOrdering;
	readonly retailVisibility: RetailGeometryVisibility;
	readonly compatibility: PreparedStaticObjectDrawCompatibility<
		TGeometry,
		TTexture,
		TSampler
	>;
}

/** Merge only adjacent depth-writing ranges; never cross visibility or ordered-blending barriers. */
export function compileStaticMaterialSpans<
	TGeometry,
	TTexture,
	TSampler,
	T extends StaticMaterialRange<TGeometry, TTexture, TSampler>,
>(ranges: readonly T[]): T[] {
	const result: T[] = [];
	for (const range of ranges) {
		const prior = result[result.length - 1];
		if (
			prior &&
			(range.ordering === "opaque" || range.ordering === "alpha-test") &&
			prior.ordering === range.ordering &&
			prior.retailVisibility === range.retailVisibility &&
			prior.indexStart + prior.indexCount === range.indexStart &&
			staticObjectTableStateEquals(prior.compatibility, range.compatibility)
		) {
			const indexCount = prior.indexCount + range.indexCount;
			result[result.length - 1] = {
				...prior,
				indexCount,
				compatibility: { ...prior.compatibility, indexCount },
			};
		} else result.push(range);
	}
	return result;
}
