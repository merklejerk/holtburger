import type {
	EnvCellCellStructureGeometryAttachment,
	EnvCellSystemStaticScopePayload,
	LandblockEnvCellStaticFacts,
	MaterialTextureDataUseIdentity,
	StaticBakeBatchAttachments,
	StaticBakeTask,
} from "../../contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "../../../math/ac-placement-transform";
import {
	createStaticMaterialRenderState,
	createStaticMaterialTextureRoleLayoutKey,
	createStaticMaterialTextureRoleSchemaKey,
	resolveStaticMaterialDetailTextureTiling,
} from "../../bake/static-material-adapter";
import {
	createObjectVisualMissingDependenciesResolution,
	createObjectVisualReadyResolution,
	createObjectVisualRecipeKeyRegistry,
	objectVisualGeometryBufferKey,
	objectVisualGeometryRecipeKey,
	objectVisualMaterialRecipeKey,
	objectVisualPartRecipeKey,
	objectVisualTextureRecipeKey,
	type ObjectVisualBundleResolution,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryBufferId,
	type ObjectVisualMaterialRecipe,
	type ObjectVisualRecipeBundle,
	type ObjectVisualTextureRecipe,
	type ObjectVisualTextureUsage,
} from "../../../visual/object-visual-recipe-bundle";
import {
	createObjectVisualPartInstanceIndex,
	createObjectVisualStaticPublicationMetadata,
	type ObjectVisualStaticPublicationMetadata,
} from "../../../visual/object-visual-static-publication";
import type {
	ObjectVisualMaterialPlan,
	ObjectVisualMaterialTextureUseRole,
} from "../../../visual/object-visual-material-planner";
import {
	createEnvCellCellStructureGeometryIdentity,
	describeEnvCellCellStructureGeometryIdentity,
} from "./env-cell-system-geometry-attachments";
import {
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorMaterialSurfaceId,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";

export interface StructuredInteriorVisualBundleExpansion {
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	readonly publicationMetadata: ObjectVisualStaticPublicationMetadata | null;
	readonly resolution: ObjectVisualBundleResolution;
}

export function createStructuredInteriorVisualBundleExpansion(input: {
	readonly attachments: Pick<
		StaticBakeBatchAttachments,
		"envCellCellStructureGeometry"
	>;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly task: StaticBakeTask;
}): StructuredInteriorVisualBundleExpansion {
	if (input.envCell.renderGeometry.triangleCount === 0) {
		return {
			geometryBuffers: new Map(),
			publicationMetadata: createObjectVisualStaticPublicationMetadata({
				partInstanceCount: 0,
			}),
			resolution: createObjectVisualReadyResolution(createEmptyBundle()),
		};
	}

	const attachment = findGeometryAttachment(input);
	if (!attachment) {
		const identity = createEnvCellCellStructureGeometryIdentity({
			envCell: input.envCell,
		});
		return {
			geometryBuffers: new Map(),
			publicationMetadata: null,
			resolution: createObjectVisualMissingDependenciesResolution([
				{
					sourceId: describeEnvCellCellStructureGeometryIdentity(identity),
					sourceKind: "env-cell-cell-structure-geometry",
				},
			]),
		};
	}

	const materialPlan = planStructuredInteriorCellMaterials({
		envCell: input.envCell,
		payload: input.payload,
		task: input.task,
	});
	const surfacePlans = [...materialPlan.materialPlansBySurfaceId.entries()]
		.sort(([left], [right]) => left - right)
		.map(([surfaceId, plan]) => ({ plan, surfaceId }));
	const registry = createObjectVisualRecipeKeyRegistry({
		geometryBufferKeys: [
			objectVisualGeometryBufferKey(
				describeEnvCellCellStructureGeometryIdentity(attachment.identity),
			),
		],
		geometryRecipeKeys: [
			objectVisualGeometryRecipeKey(createGeometryRecipeKey(input.envCell)),
		],
		materialRecipeKeys: surfacePlans.map(({ plan, surfaceId }) =>
			objectVisualMaterialRecipeKey(createMaterialRecipeKey(surfaceId, plan)),
		),
		partRecipeKeys: [
			objectVisualPartRecipeKey(createPartRecipeKey(input.envCell)),
		],
		textureRecipeKeys: createTextureRecipeKeys(
			surfacePlans.map(({ plan }) => plan),
		).map(objectVisualTextureRecipeKey),
	});
	const bufferId = requireRegistryId(
		registry.geometryBufferIdsByKey,
		objectVisualGeometryBufferKey(
			describeEnvCellCellStructureGeometryIdentity(attachment.identity),
		),
		"geometry buffer",
	);
	const geometryRecipeId = requireRegistryId(
		registry.geometryRecipeIdsByKey,
		objectVisualGeometryRecipeKey(createGeometryRecipeKey(input.envCell)),
		"geometry recipe",
	);
	const partRecipeId = requireRegistryId(
		registry.partRecipeIdsByKey,
		objectVisualPartRecipeKey(createPartRecipeKey(input.envCell)),
		"part recipe",
	);
	const geometryBuffer: ObjectVisualGeometryBuffer = {
		...attachment.buffer,
		bufferId,
	};
	const partInstanceCount = 1;
	const bundle: ObjectVisualRecipeBundle = {
		geometryBufferRefs: new Map([
			[
				bufferId,
				{
					coordinateSpace: "source-local",
					sourceKey: describeEnvCellCellStructureGeometryIdentity(
						attachment.identity,
					),
					sourceKind: "embedded-geometry",
					triangleCount: geometryBuffer.triangleCount,
					vertexCount: geometryBuffer.vertexCount,
				},
			],
		]),
		geometryRecipes: new Map([
			[
				geometryRecipeId,
				{
					bufferId,
					kind: "embedded-geometry",
				},
			],
		]),
		materialRecipes: new Map(
			surfacePlans.map(({ plan, surfaceId }) => [
				requireRegistryId(
					registry.materialRecipeIdsByKey,
					objectVisualMaterialRecipeKey(
						createMaterialRecipeKey(surfaceId, plan),
					),
					"material recipe",
				),
				createMaterialRecipe(plan, registry),
			]),
		),
		partInstances: [
			{
				instanceId: `structured-interior:${formatHex32(
					input.envCell.identity.envCellId,
				)}`,
				partRecipeId,
				residency: {
					envCellId: input.envCell.identity.envCellId,
					kind: "env-cell",
					landblockId: input.envCell.landblockId,
				},
				sourcePartIndex: null,
				transform: Array.from(
					buildAcPlacementMatrix(input.envCell.localPlacement, AC_UNIT_SCALE),
				) as [
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
					number,
				],
			},
		],
		partRecipes: new Map([
			[
				partRecipeId,
				{
					geometryRecipeId,
					materialBindings: createMaterialBindings({
						attachment,
						envCell: input.envCell,
						registry,
						surfacePlans,
					}),
				},
			],
		]),
		recipeKeys: registry.recipeKeys,
		textureRecipes: createTextureRecipes({
			materialPlans: surfacePlans.map(({ plan }) => plan),
			registry,
		}),
	};

	return {
		geometryBuffers: new Map([[bufferId, geometryBuffer]]),
		publicationMetadata: createObjectVisualStaticPublicationMetadata({
			partInstanceCount,
			structuredInteriorDrawUnits: [
				{
					cellStructure: input.envCell.cellStructure,
					drawUnitIdSeed: createDrawUnitIdSeed(input.task, input.envCell),
					envCellId: input.envCell.identity.envCellId,
					environment: input.envCell.environment,
					kind: "structured-interior-direct-draw-unit",
					landblockId: input.envCell.landblockId,
					localPlacement: input.envCell.localPlacement,
					materialPlan: materialPlan.entries,
					memberId: input.envCell.memberId,
					partInstanceIndices: [createObjectVisualPartInstanceIndex(0)],
					sourceTriangleIds: attachment.buffer.triangles.map(
						createSourceTriangleId,
					),
					surfaceIds: input.envCell.surfaces.map(
						(surface) => surface.surfaceId,
					),
				},
			],
		}),
		resolution: createObjectVisualReadyResolution(bundle),
	};
}

function createMaterialBindings(options: {
	readonly attachment: EnvCellCellStructureGeometryAttachment;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
	readonly surfacePlans: readonly {
		readonly plan: ObjectVisualMaterialPlan;
		readonly surfaceId: number;
	}[];
}): ObjectVisualRecipeBundle["partRecipes"] extends ReadonlyMap<
	unknown,
	infer TPartRecipe
>
	? TPartRecipe extends { readonly materialBindings: infer TBindings }
		? TBindings
		: never
	: never {
	return options.attachment.buffer.triangles.flatMap((triangle) => {
		if (triangle.surfaceId === null) {
			return [];
		}
		const materialSurfaceId = resolveStructuredInteriorMaterialSurfaceId(
			options.envCell,
			triangle.surfaceId,
		);
		if (materialSurfaceId === null) {
			return [];
		}
		const plan = options.surfacePlans.find(
			(candidate) => candidate.surfaceId === materialSurfaceId,
		)?.plan;
		if (!plan) {
			return [];
		}
		return {
			geometrySurfaceId: triangle.surfaceId,
			materialRecipeId: requireRegistryId(
				options.registry.materialRecipeIdsByKey,
				objectVisualMaterialRecipeKey(
					createMaterialRecipeKey(materialSurfaceId, plan),
				),
				"material recipe",
			),
			materialSlot: materialSurfaceId,
			polygonIds: [triangle.polygonId],
		};
	});
}

function createMaterialRecipe(
	plan: ObjectVisualMaterialPlan,
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
): ObjectVisualMaterialRecipe {
	const base = {
		alphaTest: plan.alphaPolicy.alphaTest,
		detailTextureTiling: resolveStaticMaterialDetailTextureTiling(plan),
		indexedClipThreshold: plan.alphaPolicy.indexedClipThreshold,
		materialColor: plan.color,
		materialEmissiveColor: plan.emissiveColor,
		paletteFirstIndex: getPaletteFirstIndex(plan.textureRoles),
		pass: plan.pass,
		primaryTextureWrapMode:
			resolveStructuredInteriorPlanTextureWrapMode(plan) === "repeat"
				? ("repeat" as const)
				: ("clamp" as const),
		renderState: createStaticMaterialRenderState(plan.blend),
		textureRoleLayoutKey: createStaticMaterialTextureRoleLayoutKey(
			plan.textureRoles,
		),
		textureRoleSchemaKey: createStaticMaterialTextureRoleSchemaKey(
			plan.textureRoles,
		),
	};
	switch (plan.family) {
		case "flat-color":
			return { ...base, family: "direct-color" };
		case "indexed-paletted":
			return {
				...base,
				colorTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-index").dataUse,
					getPlanWrapMode(plan),
				),
				family: "indexed-color",
				indexedTextureFormat: requireTextureRole(
					plan.textureRoles,
					"base-index",
				).indexedFormat,
				paletteTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "palette-rgba").dataUse,
					getPlanWrapMode(plan),
				),
			};
		case "texture-rgba":
			return {
				...base,
				detailTextureRecipeId: findTextureRole(
					plan.textureRoles,
					"detail-overlay",
				)
					? requireTextureRecipeId(
							registry,
							requireTextureRole(plan.textureRoles, "detail-overlay").dataUse,
							getPlanWrapMode(plan),
						)
					: null,
				family: "texture-rgba",
				rgbaTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-color").dataUse,
					getPlanWrapMode(plan),
				),
			};
		case "unsupported":
			return {
				...base,
				family: "unsupported",
				reason: plan.fallbackReasons.map((reason) => reason.code).join(","),
			};
	}
}

function findGeometryAttachment(input: {
	readonly attachments: Pick<
		StaticBakeBatchAttachments,
		"envCellCellStructureGeometry"
	>;
	readonly envCell: LandblockEnvCellStaticFacts;
}): EnvCellCellStructureGeometryAttachment | null {
	const identity = createEnvCellCellStructureGeometryIdentity({
		envCell: input.envCell,
	});
	const identityKey = describeEnvCellCellStructureGeometryIdentity(identity);
	return (
		input.attachments.envCellCellStructureGeometry.find(
			(candidate) =>
				describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
				identityKey,
		) ?? null
	);
}

function createTextureRecipes(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["textureRecipes"] {
	const recipes = new Map();
	for (const plan of options.materialPlans) {
		const wrapMode = getPlanWrapMode(plan);
		for (const role of plan.textureRoles) {
			const textureId = requireTextureRecipeId(
				options.registry,
				role.dataUse,
				wrapMode,
			);
			if (!recipes.has(textureId)) {
				recipes.set(textureId, createTextureRecipe(role, wrapMode));
			}
		}
	}
	return recipes;
}

function createTextureRecipe(
	role: ObjectVisualMaterialTextureUseRole,
	wrapMode: "clamp" | "repeat",
): ObjectVisualTextureRecipe {
	switch (role.role) {
		case "base-color":
		case "base-index":
		case "detail-overlay":
			return {
				dataUse: role.dataUse,
				wrapMode,
				source: {
					kind: "render-surface",
					renderSurfaceId: role.renderSurface.renderSurfaceId,
					surfaceTextureId: role.texture.surfaceTextureId,
				},
				usage: getTextureUsage(role),
			};
		case "palette-rgba":
			return {
				dataUse: role.dataUse,
				wrapMode,
				source: {
					firstIndex: role.dataUse.firstIndex,
					indexCount: role.dataUse.indexCount,
					kind: "palette",
					paletteId: role.palette.paletteId,
				},
				usage: "object-palette",
			};
	}
}

function createTextureRecipeKeys(
	materialPlans: readonly ObjectVisualMaterialPlan[],
): readonly string[] {
	return [
		...new Set(
			materialPlans.flatMap((plan) =>
				plan.textureRoles.map((role) =>
					createTextureRecipeKey(role.dataUse, getPlanWrapMode(plan)),
				),
			),
		),
	].sort();
}

function getTextureUsage(
	role: ObjectVisualMaterialTextureUseRole,
): ObjectVisualTextureUsage {
	switch (role.role) {
		case "base-color":
			return "object-base-color";
		case "base-index":
			return "object-index";
		case "detail-overlay":
			return "object-detail";
		case "palette-rgba":
			return "object-palette";
	}
}

function requireTextureRecipeId(
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
	dataUse: MaterialTextureDataUseIdentity,
	wrapMode: "clamp" | "repeat",
) {
	return requireRegistryId(
		registry.textureRecipeIdsByKey,
		objectVisualTextureRecipeKey(createTextureRecipeKey(dataUse, wrapMode)),
		"texture recipe",
	);
}

function createTextureRecipeKey(
	dataUse: MaterialTextureDataUseIdentity,
	wrapMode: "clamp" | "repeat",
): string {
	if (dataUse.kind === "palette-texture-use") {
		return [
			"palette",
			formatHex32(dataUse.palette.paletteId),
			`first:${dataUse.firstIndex}`,
			`count:${dataUse.indexCount}`,
			`wrap:${wrapMode}`,
		].join(":");
	}
	return [
		"render-surface",
		formatHex32(dataUse.renderSurface.renderSurfaceId),
		dataUse.usage,
		`wrap:${wrapMode}`,
	].join(":");
}

function getPlanWrapMode(plan: ObjectVisualMaterialPlan): "clamp" | "repeat" {
	return resolveStructuredInteriorPlanTextureWrapMode(plan) === "repeat"
		? "repeat"
		: "clamp";
}

function findTextureRole<
	TRole extends ObjectVisualMaterialTextureUseRole["role"],
>(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
	role: TRole,
): Extract<
	ObjectVisualMaterialTextureUseRole,
	{ readonly role: TRole }
> | null {
	return (
		roles.find(
			(
				candidate,
			): candidate is Extract<
				ObjectVisualMaterialTextureUseRole,
				{ readonly role: TRole }
			> => candidate.role === role,
		) ?? null
	);
}

function requireTextureRole<
	TRole extends ObjectVisualMaterialTextureUseRole["role"],
>(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
	role: TRole,
): Extract<ObjectVisualMaterialTextureUseRole, { readonly role: TRole }> {
	const found = findTextureRole(roles, role);
	if (!found) {
		throw new Error(
			`Structured interior material recipe requires texture role ${role}.`,
		);
	}
	return found;
}

function getPaletteFirstIndex(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
): number {
	return findTextureRole(roles, "palette-rgba")?.dataUse.firstIndex ?? 0;
}

function createEmptyBundle(): ObjectVisualRecipeBundle {
	return {
		geometryBufferRefs: new Map(),
		geometryRecipes: new Map(),
		materialRecipes: new Map(),
		partInstances: [],
		partRecipes: new Map(),
		recipeKeys: {
			geometryBufferKeys: [],
			geometryRecipeKeys: [],
			materialRecipeKeys: [],
			partRecipeKeys: [],
			textureRecipeKeys: [],
		},
		textureRecipes: new Map(),
	};
}

function createGeometryRecipeKey(envCell: LandblockEnvCellStaticFacts): string {
	return `structured-interior:geometry:${formatHex32(envCell.identity.envCellId)}`;
}

function createPartRecipeKey(envCell: LandblockEnvCellStaticFacts): string {
	return `structured-interior:part:${formatHex32(envCell.identity.envCellId)}`;
}

function createMaterialRecipeKey(
	surfaceId: number,
	plan: ObjectVisualMaterialPlan,
): string {
	return [`surface:${surfaceId}`, plan.materialUseKey].join("|");
}

function createDrawUnitIdSeed(
	task: StaticBakeTask,
	envCell: LandblockEnvCellStaticFacts,
): string {
	return [
		task.taskId,
		"structured-interior",
		formatHex32(envCell.identity.envCellId),
		formatHex32(envCell.cellStructure.cellStructureId),
	].join(":");
}

function createSourceTriangleId(triangle: {
	readonly firstVertex: number;
	readonly materialVariantSignature: string | null;
	readonly polygonId: number;
	readonly surfaceId: number | null;
}): string {
	return [
		`polygon:${triangle.polygonId}`,
		`surface:${triangle.surfaceId ?? "none"}`,
		`first:${triangle.firstVertex}`,
		`variant:${triangle.materialVariantSignature ?? "none"}`,
	].join("|");
}

function requireRegistryId<TKey, TId>(
	map: ReadonlyMap<TKey, TId>,
	key: TKey,
	subject: string,
): TId {
	const id = map.get(key);
	if (id === undefined) {
		throw new Error(
			`Missing structured interior ${subject} id for ${String(key)}.`,
		);
	}
	return id;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
