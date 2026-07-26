import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import { planObjectMaterial } from "../resolution/object-material-planner";
import {
	type AssetTextureFact,
	type AssetTextureKey,
	TextureWrapMode,
} from "../textures/types";

/** Collect exactly the logical pixel dependencies used by static object triangles. */
export function collectStaticObjectTextureDependencies(
	source: ResolvedOutdoorStaticLayerSource,
): readonly AssetTextureFact[] {
	const dependencies = new Map<AssetTextureKey, AssetTextureFact>();
	for (const resident of source.staticResidents) {
		for (const part of resident.presentation.parts) {
			for (const [
				triangle,
				slot,
			] of part.geometry.materialSlotIndices.entries()) {
				const material = part.materials[slot];
				if (!material) {
					throw new Error(
						`Static resident ${resident.id} part ${part.partIndex} triangle ${triangle} has no material slot ${slot}.`,
					);
				}
				const plan = planObjectMaterial(
					material,
					part.geometry.materialWrapModes[triangle] === 1
						? TextureWrapMode.Repeat
						: TextureWrapMode.Clamp,
				);
				addDependencies(dependencies, plan.textureRequirements);
			}
		}
	}
	return [...dependencies.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function addDependencies(
	target: Map<AssetTextureKey, AssetTextureFact>,
	facts: readonly AssetTextureFact[],
): void {
	for (const fact of facts) {
		const existing = target.get(fact.key);
		if (
			existing &&
			(existing.purpose !== fact.purpose ||
				existing.sourceAssetId !== fact.sourceAssetId)
		) {
			throw new Error(
				`Logical texture ${fact.key} has incompatible source requirements.`,
			);
		}
		target.set(fact.key, fact);
	}
}
