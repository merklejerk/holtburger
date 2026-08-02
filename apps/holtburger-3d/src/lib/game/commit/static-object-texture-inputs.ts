import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
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
	collectResidentDependencies(dependencies, source.staticResidents, detailRole);
	return mergeAssetTextureFacts(dependencies, "Authored object source");
}

function collectResidentDependencies(
	dependencies: AssetTextureFact[],
	residents: readonly {
		readonly identity: { readonly sourceId: string };
		readonly presentation: ResolvedStaticObjectLayerSource["staticResidents"][number]["presentation"];
	}[],
	detailRole: ReturnType<typeof staticObjectDetailRoleForSource>,
): void {
	for (const resident of residents) {
		for (const part of resident.presentation.parts) {
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
}
