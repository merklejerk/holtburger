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
		(plan.family === "texture-rgba" || plan.family === "indexed-paletted") &&
		(plan.pass === "opaque" || plan.pass === "alpha-test") &&
		plan.renderCoverage === "classified-render-candidate" &&
		isCurrentlyStageableStaticObjectDataUseLayout(
			plan.textureRoles.map((role) => role.dataUse),
		)
	);
}

export function isRenderableStaticObjectPartition(
	partition: StaticObjectCompatibilityPartition,
): boolean {
	if (
		partition.family === "flat-color" &&
		(partition.pass === "opaque" || partition.pass === "alpha-test") &&
		partition.renderCoverage === "classified-render-candidate" &&
		partition.coarseTablePlan.entries.every(
			(entry) => entry.textureDataUses.length === 0,
		)
	) {
		return true;
	}

	return (
		(partition.family === "texture-rgba" ||
			partition.family === "indexed-paletted") &&
		(partition.pass === "opaque" || partition.pass === "alpha-test") &&
		partition.renderCoverage === "classified-render-candidate" &&
		partition.coarseTablePlan.entries.every((entry) =>
			isCurrentlyStageableStaticObjectDataUseLayout(entry.textureDataUses),
		)
	);
}

export function isCurrentlyStageableStaticObjectDataUse(
	dataUse: MaterialTextureDataUseIdentity | undefined,
): boolean {
	return (
		dataUse?.kind === "prepared-render-surface-texture-use" &&
		(dataUse.usage === "rgba-color" ||
			dataUse.usage === "rgba-detail" ||
			dataUse.usage === "index8" ||
			dataUse.usage === "index16")
	) || dataUse?.kind === "palette-texture-use";
}

function isCurrentlyStageableStaticObjectDataUseLayout(
	dataUses: readonly MaterialTextureDataUseIdentity[],
): boolean {
	const colorUseCount = dataUses.filter(
		(use) =>
			use.kind === "prepared-render-surface-texture-use" &&
			use.usage === "rgba-color",
	).length;
	const detailUseCount = dataUses.filter(
		(use) =>
			use.kind === "prepared-render-surface-texture-use" &&
			use.usage === "rgba-detail",
	).length;
	const indexUseCount = dataUses.filter(
		(use) =>
			use.kind === "prepared-render-surface-texture-use" &&
			(use.usage === "index8" || use.usage === "index16"),
	).length;
	const paletteUseCount = dataUses.filter(
		(use) => use.kind === "palette-texture-use",
	).length;

	if (
		(dataUses.length === 1 || dataUses.length === 2) &&
		colorUseCount === 1 &&
		detailUseCount === dataUses.length - 1
	) {
		return true;
	}

	return (
		(dataUses.length === 2 || dataUses.length === 3) &&
		indexUseCount === 1 &&
		paletteUseCount === 1 &&
		(dataUses.length === 2 ? detailUseCount === 0 : detailUseCount === 1)
	);
}
