import type { MaterialTextureDataUseIdentity } from "../../contracts";
import type {
	StaticObjectCompatibilityPartition,
} from "./static-object-compatibility-partitioner";
import type { StaticObjectMaterialPlan } from "./static-object-material-planner";

export function isRenderableStaticObjectMaterialPlan(
	plan: StaticObjectMaterialPlan,
): boolean {
	if (
		plan.family === "flat-color" &&
		(plan.pass === "opaque" || plan.pass === "alpha-test") &&
		plan.renderCoverage === "classified-render-candidate" &&
		plan.textureRoles.length === 0
	) {
		return true;
	}

	return (
		plan.family === "texture-rgba" &&
		(plan.pass === "opaque" || plan.pass === "alpha-test") &&
		plan.renderCoverage === "classified-render-candidate" &&
		plan.textureRoles.length === 1 &&
		isCurrentlyStageableStaticObjectDataUse(plan.textureRoles[0]?.dataUse)
	);
}

export function isRenderableStaticObjectPartition(
	partition: StaticObjectCompatibilityPartition,
): boolean {
	if (
		partition.family === "flat-color" &&
		(partition.pass === "opaque" || partition.pass === "alpha-test") &&
		partition.renderCoverage === "classified-render-candidate" &&
		partition.textureDataUses.length === 0
	) {
		return true;
	}

	return (
		partition.family === "texture-rgba" &&
		(partition.pass === "opaque" || partition.pass === "alpha-test") &&
		partition.renderCoverage === "classified-render-candidate" &&
		partition.textureDataUses.length === 1 &&
		isCurrentlyStageableStaticObjectDataUse(partition.textureDataUses[0])
	);
}

export function isCurrentlyStageableStaticObjectDataUse(
	dataUse: MaterialTextureDataUseIdentity | undefined,
): boolean {
	return (
		dataUse?.kind === "prepared-render-surface-texture-use" &&
		dataUse.usage === "rgba-color"
	);
}
