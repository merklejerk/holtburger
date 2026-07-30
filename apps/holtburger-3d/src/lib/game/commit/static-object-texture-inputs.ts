import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import { planObjectMaterial } from "../resolution/object-material-planner";
import { staticObjectDetailRoleForSource } from "../resolution/static-detail-role";
import { type AssetTextureFact, TextureWrapMode } from "../textures/types";
import { mergeAssetTextureFacts } from "../textures/texture-facts";

/** Collect exactly the logical pixel dependencies used by static object triangles. */
export function collectStaticObjectTextureDependencies(
	source: ResolvedStaticObjectLayerSource,
): readonly AssetTextureFact[] {
	const dependencies: AssetTextureFact[] = [];
	const detailRole = staticObjectDetailRoleForSource(source);
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
					detailRole,
				);
				dependencies.push(...plan.textureRequirements);
			}
		}
	}
	return mergeAssetTextureFacts(dependencies, "Static object");
}
