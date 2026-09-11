import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import type {
	ResolvedMaterial,
	ResolvedObjectPart,
} from "../resolution/presentation";
import { planObjectMaterial } from "../resolution/object-material-planner";
import { staticObjectDetailRoleForSource } from "../resolution/static-detail-role";
import { type AssetTextureFact, TextureWrapMode } from "../textures/types";
import { mergeAssetTextureFacts } from "../textures/texture-facts";

/** Collect logical pixel dependencies owned by the static draw batch only. */
export function collectStaticObjectTextureDependencies(
	source: ResolvedStaticObjectLayerSource,
): readonly AssetTextureFact[] {
	const dependencies: AssetTextureFact[] = [];
	const detailRole = staticObjectDetailRoleForSource(source);
	// Decoded definitions share parts and materials across placements. Keep identity reuse local:
	// geometry alone can have different material closures, and IDs are not global source identities.
	const visitedParts = new Set<ResolvedObjectPart>();
	const visitedMaterials = new Set<ResolvedMaterial>();
	for (const resident of source.staticResidents) {
		for (const part of resident.presentation.parts) {
			if (visitedParts.has(part)) continue;
			visitedParts.add(part);
			for (const [
				triangle,
				slot,
			] of part.geometry.materialSlotIndices.entries()) {
				const material = part.materials[slot];
				if (!material) {
					throw new Error(
						`Authored resident ${resident.identity.sourceId} part ${part.partIndex} triangle ${triangle} has no material slot ${slot}.`,
					);
				}
				if (visitedMaterials.has(material)) continue;
				visitedMaterials.add(material);
				// Wrap and detail affect draw bindings, but not the material's pixel dependencies.
				// Only plan the first referenced use; unused slots remain outside this owner's demand.
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
	return mergeAssetTextureFacts(dependencies, "Authored object source");
}
