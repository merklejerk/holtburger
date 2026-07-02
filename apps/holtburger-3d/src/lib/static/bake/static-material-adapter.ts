import type {
	MaterialTextureDataUseIdentity,
	StaticMaterialTableEntry,
	StaticObjectRenderState,
} from "../contracts";
import type {
	ObjectVisualMaterialPlan,
	ObjectVisualMaterialTextureUseRole,
} from "../../visual/object-visual-material-planner";
import {
	createMaterialTextureDataUseKey,
	type StaticMaterialTextureWrapMode,
} from "./static-material-texture-policy";

export interface StaticMaterialTextureUseIdFactory {
	(
		dataUse: MaterialTextureDataUseIdentity,
		wrapMode: StaticMaterialTextureWrapMode,
	): string;
}

export function createStaticMaterialEntryKey(options: {
	readonly plan: ObjectVisualMaterialPlan;
	readonly textureWrapMode: StaticMaterialTextureWrapMode;
}): string {
	return [
		`color:${createStaticMaterialColorKey(options.plan)}`,
		`wrap:${options.textureWrapMode}`,
		`roles:${createStaticMaterialTextureRoleLayoutKey(
			options.plan.textureRoles,
		)}`,
		`alpha-test:${formatMaterialScalar(options.plan.alphaPolicy.alphaTest)}`,
		`indexed-clip:${formatMaterialScalar(
			options.plan.alphaPolicy.indexedClipThreshold,
		)}`,
		`detail-tiling:${formatMaterialScalar(
			resolveStaticMaterialDetailTextureTiling(options.plan),
		)}`,
	].join("|");
}

export function createStaticMaterialColorKey(
	plan: ObjectVisualMaterialPlan,
): string {
	return [
		...plan.color.map(formatMaterialScalar),
		...plan.emissiveColor.map(formatMaterialScalar),
	].join(",");
}

export function createStaticMaterialTextureRoleLayoutKey(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => {
			const detailSuffix =
				role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
			return `${role.role}:${createMaterialTextureDataUseKey(role.dataUse)}${detailSuffix}`;
		})
		.join(",");
}

export function createStaticMaterialTextureRoleSchemaKey(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => {
			const detailSuffix =
				role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
			return `${role.role}:${createStaticMaterialTextureDataUseSchemaKey(role.dataUse)}${detailSuffix}`;
		})
		.join(",");
}

export function createStaticMaterialTableEntry(options: {
	readonly createTextureUseId: StaticMaterialTextureUseIdFactory;
	readonly materialIds: readonly number[];
	readonly plan: ObjectVisualMaterialPlan;
	readonly slot: number;
	readonly textureWrapMode: StaticMaterialTextureWrapMode;
}): StaticMaterialTableEntry {
	const primaryTextureUse = findPreparedTextureDataUse(
		options.plan,
		"rgba-color",
	);
	const indexTextureUse =
		findPreparedTextureDataUse(options.plan, "index8") ??
		findPreparedTextureDataUse(options.plan, "index16");
	const paletteTextureUse =
		options.plan.textureRoles
			.map((role) => role.dataUse)
			.find((dataUse) => dataUse.kind === "prepared-palette-texture-use") ??
		null;
	const detailTextureUse = findPreparedTextureDataUse(
		options.plan,
		"rgba-detail",
	);
	const indexedTextureFormat =
		indexTextureUse?.kind === "prepared-render-surface-texture-use"
			? indexTextureUse.usage === "index16"
				? "index16"
				: "p8"
			: null;

	return {
		alphaTest: options.plan.alphaPolicy.alphaTest,
		detailTextureTiling: resolveStaticMaterialDetailTextureTiling(options.plan),
		detailTextureUseId: detailTextureUse
			? options.createTextureUseId(detailTextureUse, options.textureWrapMode)
			: null,
		indexedClipThreshold: options.plan.alphaPolicy.indexedClipThreshold,
		indexedTextureFormat,
		indexTextureUseId: indexTextureUse
			? options.createTextureUseId(indexTextureUse, options.textureWrapMode)
			: null,
		materialColor: options.plan.color,
		materialEmissiveColor: options.plan.emissiveColor,
		materialIds: options.materialIds,
		paletteTextureUseId: paletteTextureUse
			? options.createTextureUseId(paletteTextureUse, options.textureWrapMode)
			: null,
		primaryTextureUseId: primaryTextureUse
			? options.createTextureUseId(primaryTextureUse, options.textureWrapMode)
			: null,
		primaryTextureWrapMode: options.textureWrapMode,
		renderState: createStaticMaterialRenderState(options.plan.blend),
		slot: options.slot,
	};
}

export function createStaticMaterialRenderState(
	blend: ObjectVisualMaterialPlan["blend"],
): StaticObjectRenderState {
	return {
		blend: {
			dstFactor: blend.dstFactor,
			enabled: blend.enabled,
			mode: blend.mode,
			srcFactor: blend.srcFactor,
		},
		depthTest: true,
		depthWrite: blend.depthWrite,
	};
}

export function resolveStaticMaterialDetailTextureTiling(
	plan: ObjectVisualMaterialPlan,
): number {
	const detailRole = plan.textureRoles.find(
		(role) => role.role === "detail-overlay",
	);
	return detailRole?.role === "detail-overlay" ? detailRole.tiling : 1;
}

function findPreparedTextureDataUse(
	plan: ObjectVisualMaterialPlan,
	usage: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-render-surface-texture-use" }
	>["usage"],
): MaterialTextureDataUseIdentity | null {
	return (
		plan.textureRoles
			.map((role) => role.dataUse)
			.find(
				(dataUse) =>
					dataUse.kind === "prepared-render-surface-texture-use" &&
					dataUse.usage === usage,
			) ?? null
	);
}

function createStaticMaterialTextureDataUseSchemaKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "prepared-palette-texture-use") {
		return [dataUse.kind, dataUse.domain, dataUse.usage].join(":");
	}

	return [dataUse.kind, dataUse.usage].join(":");
}

function formatMaterialScalar(value: number): string {
	return value.toFixed(6);
}
