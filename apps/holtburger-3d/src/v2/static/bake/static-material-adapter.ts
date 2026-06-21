import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
	StaticDomain,
	StaticMaterialTableEntry,
	StaticObjectRenderState,
} from "../contracts";
import type {
	StaticMaterialPlan,
	StaticMaterialTextureUseRole,
} from "../objects/bake/static-object-material-planner";
import {
	createMaterialTextureDataUseKey,
	createStaticMaterialTextureSamplingPolicy,
	type StaticMaterialTextureWrapMode,
} from "./static-material-texture-policy";

export interface StaticMaterialTextureUseIdFactory {
	(
		dataUse: MaterialTextureDataUseIdentity,
		wrapMode: StaticMaterialTextureWrapMode,
	): string;
}

export interface StaticMaterialTextureUseSpec {
	readonly ownerDrawUnitId: string;
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly textureWrapMode: StaticMaterialTextureWrapMode;
}

export function createStaticMaterialEntryKey(options: {
	readonly plan: StaticMaterialPlan;
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

export function createStaticMaterialColorKey(plan: StaticMaterialPlan): string {
	return [
		...plan.color.map(formatMaterialScalar),
		...plan.emissiveColor.map(formatMaterialScalar),
	].join(",");
}

export function createStaticMaterialTextureRoleLayoutKey(
	roles: readonly StaticMaterialTextureUseRole[],
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
	roles: readonly StaticMaterialTextureUseRole[],
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
	readonly plan: StaticMaterialPlan;
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
			.find((dataUse) => dataUse.kind === "palette-texture-use") ?? null;
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
		paletteFirstIndex:
			paletteTextureUse?.kind === "palette-texture-use"
				? paletteTextureUse.firstIndex
				: 0,
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
	blend: StaticMaterialPlan["blend"],
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

export function createStaticMaterialTextureUses(options: {
	readonly createTextureUseId: StaticMaterialTextureUseIdFactory;
	readonly domain: StaticDomain;
	readonly isStageableDataUse: (
		dataUse: MaterialTextureDataUseIdentity,
	) => boolean;
	readonly staticBatchId: string;
	readonly textureUseSpecs: readonly StaticMaterialTextureUseSpec[];
}): readonly StaticBakeTextureUse[] {
	const textureUsesById = new Map<string, StaticBakeTextureUse>();

	for (const spec of options.textureUseSpecs) {
		for (const dataUse of spec.textureDataUses) {
			if (!options.isStageableDataUse(dataUse)) {
				continue;
			}

			const textureUseId = options.createTextureUseId(
				dataUse,
				spec.textureWrapMode,
			);
			const existing = textureUsesById.get(textureUseId);
			if (existing) {
				textureUsesById.set(textureUseId, {
					...existing,
					ownerDrawUnitIds: [
						...existing.ownerDrawUnitIds,
						spec.ownerDrawUnitId,
					],
				});
				continue;
			}

			textureUsesById.set(textureUseId, {
				domain: options.domain,
				ownerDrawUnitIds: [spec.ownerDrawUnitId],
				samplingPolicy: createStaticMaterialTextureSamplingPolicy({
					dataUse,
					wrapMode: spec.textureWrapMode,
				}),
				source: dataUse,
				staticBatchId: options.staticBatchId,
				textureUseId,
			});
		}
	}

	return [...textureUsesById.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

export function resolveStaticMaterialDetailTextureTiling(
	plan: StaticMaterialPlan,
): number {
	const detailRole = plan.textureRoles.find(
		(role) => role.role === "detail-overlay",
	);
	return detailRole?.role === "detail-overlay" ? detailRole.tiling : 1;
}

function findPreparedTextureDataUse(
	plan: StaticMaterialPlan,
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
	if (dataUse.kind === "palette-texture-use") {
		return [
			dataUse.kind,
			`range:${dataUse.firstIndex}-${dataUse.indexCount}`,
			dataUse.usage,
		].join(":");
	}

	return [dataUse.kind, dataUse.usage].join(":");
}

function formatMaterialScalar(value: number): string {
	return value.toFixed(6);
}
