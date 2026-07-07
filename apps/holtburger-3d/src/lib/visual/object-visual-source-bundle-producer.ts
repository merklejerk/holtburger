import type {
	MaterialTextureDataUseIdentity,
	StaticBakeJobResources,
	StaticObjectSourceGeometrySidecar,
} from "../static/contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
} from "../math/ac-placement-transform";
import {
	createStaticMaterialRenderState,
	createStaticMaterialTextureRoleLayoutKey,
	createStaticMaterialTextureRoleSchemaKey,
	resolveStaticMaterialDetailTextureTiling,
} from "../static/bake/static-material-adapter";
import {
	createObjectVisualMaterialUseKey,
	planObjectVisualMaterials,
	type ObjectVisualMaterialPlan,
	type ObjectVisualMaterialTextureUseRole,
} from "./object-visual-material-planner";
import {
	addObjectVisualPartMaterialBinding,
	createObjectVisualMissingDependenciesResolution,
	createObjectVisualReadyResolution,
	createObjectVisualRecipeKeyRegistry,
	objectVisualGeometryBufferKey,
	objectVisualGeometryRecipeKey,
	objectVisualMaterialRecipeKey,
	objectVisualMaterialVariantSignature,
	objectVisualPartRecipeKey,
	objectVisualTextureRecipeKey,
	type ObjectVisualBundleResolution,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryBufferId,
	type ObjectVisualGeometryRecipe,
	type ObjectVisualGeometryRecipeId,
	type ObjectVisualMaterialRecipe,
	type ObjectVisualPartMaterialBinding,
	type ObjectVisualRecipeBundle,
	type ObjectVisualTextureRecipe,
	type ObjectVisualTextureRecipeId,
	type ObjectVisualTriangleMaterialBindingKey,
	type ObjectVisualTextureUsage,
} from "./object-visual-recipe-bundle";
import {
	describeStaticObjectCanonicalGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static/objects/static-object-source-assets";
import type {
	ObjectVisualMaterialSlotFacts,
	ObjectVisualObjectIdentity,
	ObjectVisualPartSourceFacts,
	ObjectVisualSourceIdentity,
	ObjectVisualSourcePayload,
} from "./object-visual-source-payload";

export interface ObjectVisualSourceBundleExpansion {
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	readonly resolution: ObjectVisualBundleResolution;
}

export interface ObjectVisualSourceRecipePlan {
	readonly materialPlan: ReturnType<typeof planObjectVisualMaterials>;
	readonly materialRecipes: ObjectVisualRecipeBundle["materialRecipes"];
	readonly textureRecipes: ObjectVisualRecipeBundle["textureRecipes"];
}

export function createObjectVisualSourceBundleExpansion(input: {
	readonly geometrySidecars: Pick<
		StaticBakeJobResources,
		"staticObjectSourceGeometry"
	>;
	readonly payload: ObjectVisualSourcePayload;
}): ObjectVisualSourceBundleExpansion {
	const missingSidecars = findMissingGeometrySidecars(
		input.payload,
		input.geometrySidecars.staticObjectSourceGeometry,
	);
	if (missingSidecars.length > 0) {
		return {
			geometryBuffers: new Map(),
			resolution: createObjectVisualMissingDependenciesResolution(
				missingSidecars.map((sourceId) => ({
					sourceId,
					sourceKind: "static-object-source-geometry",
				})),
			),
		};
	}

	const recipePlan = createObjectVisualSourceRecipePlan(input.payload);
	const registry = recipePlan.registry;
	const geometryBuffers = createGeometryBuffers({
		geometrySidecars: input.geometrySidecars.staticObjectSourceGeometry,
		payload: input.payload,
		registry,
	});
	const geometryRecipes = createGeometryRecipes({
		payload: input.payload,
		registry,
	});
	const partRecipes = createPartRecipes({
		materialPlans: recipePlan.materialPlan.materialPlans,
		payload: input.payload,
		registry,
	});
	const partInstances = createPartInstances({
		payload: input.payload,
		registry,
	});
	const bundle: ObjectVisualRecipeBundle = {
		geometryBufferRefs: new Map(
			[...geometryBuffers.values()].map((buffer) => [
				buffer.bufferId,
				{
					coordinateSpace: "source-local",
					sourceKey: `static-object-buffer:${buffer.bufferId}`,
					sourceKind: "gfx-obj",
					triangleCount: buffer.triangleCount,
					vertexCount: buffer.vertexCount,
				},
			]),
		),
		geometryRecipes,
		materialRecipes: recipePlan.materialRecipes,
		partInstances,
		partRecipes,
		recipeKeys: registry.recipeKeys,
		textureRecipes: recipePlan.textureRecipes,
	};

	return {
		geometryBuffers,
		resolution: createObjectVisualReadyResolution(bundle),
	};
}

export function createObjectVisualSourceRecipePlan(
	payload: ObjectVisualSourcePayload,
): ObjectVisualSourceRecipePlan & {
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
} {
	const materialPlan = planObjectVisualMaterials(payload);
	const materialRecipeSpecs = collectMaterialRecipeSpecs({
		materialPlans: materialPlan.materialPlans,
		payload,
	});
	const registry = createObjectVisualRecipeKeyRegistry(
		createRecipeKeys({
			materialRecipeSpecs,
			payload,
		}),
	);
	return {
		materialPlan,
		materialRecipes: createMaterialRecipes({
			materialRecipeSpecs,
			registry,
		}),
		registry,
		textureRecipes: createTextureRecipes({
			materialRecipeSpecs,
			registry,
		}),
	};
}

interface MaterialRecipeSpec {
	readonly key: string;
	readonly plan: ObjectVisualMaterialPlan;
	readonly textureWrapMode: "clamp" | "repeat";
}

function createRecipeKeys(options: {
	readonly payload: ObjectVisualSourcePayload;
	readonly materialRecipeSpecs: readonly MaterialRecipeSpec[];
}) {
	const geometryBufferKeys = new Set<string>();
	const geometryRecipeKeys = new Set<string>();
	const partRecipeKeys = new Set<string>();
	for (const source of options.payload.sourceAssets) {
		for (const part of source.parts) {
			const canonical = getStaticObjectCanonicalGeometryIdentity(part.geometry);
			geometryBufferKeys.add(createGeometryBufferKey(canonical));
			geometryRecipeKeys.add(createGeometryRecipeKey(part));
		}
	}
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			partRecipeKeys.add(createPartRecipeKey(object.identity, part));
		}
	}

	return {
		geometryBufferKeys: [...geometryBufferKeys].map(
			objectVisualGeometryBufferKey,
		),
		geometryRecipeKeys: [...geometryRecipeKeys].map(
			objectVisualGeometryRecipeKey,
		),
		materialRecipeKeys: options.materialRecipeSpecs.map((spec) =>
			objectVisualMaterialRecipeKey(spec.key),
		),
		partRecipeKeys: [...partRecipeKeys].map(objectVisualPartRecipeKey),
		textureRecipeKeys: createTextureRecipeKeys(options.materialRecipeSpecs).map(
			objectVisualTextureRecipeKey,
		),
	};
}

function createGeometryBuffers(options: {
	readonly geometrySidecars: readonly StaticObjectSourceGeometrySidecar[];
	readonly payload: ObjectVisualSourcePayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ReadonlyMap<ObjectVisualGeometryBufferId, ObjectVisualGeometryBuffer> {
	const requiredKeys = collectPayloadGeometryBufferKeys(options.payload);
	return new Map(
		options.geometrySidecars.flatMap((sidecar) => {
			const bufferKey = createGeometryBufferKey(sidecar.identity);
			if (!requiredKeys.has(bufferKey)) {
				return [];
			}
			const key = objectVisualGeometryBufferKey(bufferKey);
			const bufferId = requireRegistryId(
				options.registry.geometryBufferIdsByKey,
				key,
				"geometry buffer",
			);
			return [
				[
					bufferId,
					{
						...sidecar.buffer,
						bufferId,
					},
				],
			];
		}),
	);
}

function collectPayloadGeometryBufferKeys(
	payload: ObjectVisualSourcePayload,
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const source of payload.sourceAssets) {
		for (const part of source.parts) {
			keys.add(
				createGeometryBufferKey(
					getStaticObjectCanonicalGeometryIdentity(part.geometry),
				),
			);
		}
	}
	return keys;
}

function createGeometryRecipes(options: {
	readonly payload: ObjectVisualSourcePayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ReadonlyMap<ObjectVisualGeometryRecipeId, ObjectVisualGeometryRecipe> {
	const recipes = new Map();
	for (const source of options.payload.sourceAssets) {
		for (const part of source.parts) {
			const recipeId = requireRegistryId(
				options.registry.geometryRecipeIdsByKey,
				objectVisualGeometryRecipeKey(createGeometryRecipeKey(part)),
				"geometry recipe",
			);
			const bufferId = requireRegistryId(
				options.registry.geometryBufferIdsByKey,
				objectVisualGeometryBufferKey(
					createGeometryBufferKey(
						getStaticObjectCanonicalGeometryIdentity(part.geometry),
					),
				),
				"geometry buffer",
			);
			recipes.set(recipeId, {
				bufferId,
				kind: "gfx-obj",
				sourceDid: part.gfxObj.sourceDid,
			});
		}
	}
	return recipes;
}

function createPartRecipes(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly payload: ObjectVisualSourcePayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["partRecipes"] {
	const materialByUseKey = new Map(
		options.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const materialSlots = new MaterialSlotIndex(options.payload);
	const recipes = new Map();
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			const recipeId = requireRegistryId(
				options.registry.partRecipeIdsByKey,
				objectVisualPartRecipeKey(createPartRecipeKey(object.identity, part)),
				"part recipe",
			);
			const geometryRecipeId = requireRegistryId(
				options.registry.geometryRecipeIdsByKey,
				objectVisualGeometryRecipeKey(createGeometryRecipeKey(part)),
				"geometry recipe",
			);
			const bindingsByTriangleMaterial = new Map<
				ObjectVisualTriangleMaterialBindingKey,
				ObjectVisualPartMaterialBinding
			>();
			for (const triangle of part.triangles) {
				const slot = materialSlots.resolveMaterialSlot(
					object.identity,
					part,
					triangle,
				);
				if (!slot || triangle.geometrySurfaceId === null) {
					continue;
				}
				const plan = materialByUseKey.get(
					createObjectVisualMaterialUseKey(
						slot.material,
						slot.paletteOverride,
						slot.paletteViews,
					),
				);
				if (!plan) {
					continue;
				}
				addObjectVisualPartMaterialBinding({
					binding: {
						geometrySurfaceId: triangle.geometrySurfaceId,
						materialVariantSignature: objectVisualMaterialVariantSignature(
							triangle.materialVariantSignature,
						),
						materialRecipeId: requireRegistryId(
							options.registry.materialRecipeIdsByKey,
							objectVisualMaterialRecipeKey(
								createMaterialRecipeKey(
									plan,
									resolveTextureWrapMode(
										triangle.materialVariantSignature ?? null,
									),
								),
							),
							"material recipe",
						),
						materialSlot: getMaterialSlotIndex(slot),
						polygonIds: [triangle.polygonId],
					},
					bindingsByTriangleMaterial,
					ownerLabel: `object visual part recipe ${recipeId}`,
				});
			}
			recipes.set(recipeId, {
				geometryRecipeId,
				materialBindings: [...bindingsByTriangleMaterial.values()],
			});
		}
	}
	return recipes;
}

function getMaterialSlotIndex(
	slot:
		| ObjectVisualMaterialSlotFacts
		| ObjectVisualPartSourceFacts["materialSlots"][number],
): number {
	return "slotIndex" in slot ? slot.slotIndex : slot.identity.slotIndex;
}

function createPartInstances(options: {
	readonly payload: ObjectVisualSourcePayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["partInstances"] {
	return options.payload.objects.flatMap((object) => {
		const source = requireSource(options.payload, object.source);
		return source.parts.map((part) => ({
			instanceId: [
				createObjectKey(object.identity),
				createSourceKey(part.source),
				createSourceKey(part.gfxObj),
				`part:${part.partIndex}`,
			].join("|"),
			partRecipeId: requireRegistryId(
				options.registry.partRecipeIdsByKey,
				objectVisualPartRecipeKey(createPartRecipeKey(object.identity, part)),
				"part recipe",
			),
			residency:
				options.payload.domain === "env-cell-system" &&
				object.owningEnvCellId !== undefined &&
				object.owningEnvCellId !== null
					? {
							envCellId: object.owningEnvCellId,
							kind: "env-cell" as const,
							landblockId: options.payload.landblock.landblockId,
						}
					: {
							kind: "outdoor-landblock" as const,
							landblockId: options.payload.landblock.landblockId,
						},
			sourcePartIndex: null,
			transform: Array.from(
				createObjectVisualSourcePartMatrix(object, part),
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
		}));
	});
}

function createMaterialRecipes(options: {
	readonly materialRecipeSpecs: readonly MaterialRecipeSpec[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["materialRecipes"] {
	return new Map(
		options.materialRecipeSpecs.map((spec) => [
			requireRegistryId(
				options.registry.materialRecipeIdsByKey,
				objectVisualMaterialRecipeKey(spec.key),
				"material recipe",
			),
			createMaterialRecipe(spec, options.registry),
		]),
	);
}

function createMaterialRecipe(
	spec: MaterialRecipeSpec,
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
): ObjectVisualMaterialRecipe {
	const plan = spec.plan;
	const base = {
		alphaTest: plan.alphaPolicy.alphaTest,
		detailTextureTiling: resolveStaticMaterialDetailTextureTiling(plan),
		indexedClipThreshold: plan.alphaPolicy.indexedClipThreshold,
		materialColor: plan.color,
		materialEmissiveColor: plan.emissiveColor,
		pass: plan.pass,
		primaryTextureWrapMode: spec.textureWrapMode,
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
			return {
				...base,
				detailTextureRecipeId: findTextureRole(
					plan.textureRoles,
					"detail-overlay",
				)
					? requireTextureRecipeId(
							registry,
							requireTextureRole(plan.textureRoles, "detail-overlay").dataUse,
							resolveTextureRoleWrapMode(
								requireTextureRole(plan.textureRoles, "detail-overlay"),
								spec.textureWrapMode,
							),
						)
					: null,
				family: "direct-color",
			};
		case "indexed-paletted":
			return {
				...base,
				colorTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-index").dataUse,
					spec.textureWrapMode,
				),
				family: "indexed-color",
				indexedTextureFormat:
					requireTextureRole(plan.textureRoles, "base-index").indexedFormat ===
					"index16"
						? "index16"
						: "p8",
				paletteTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "palette-rgba").dataUse,
					spec.textureWrapMode,
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
							resolveTextureRoleWrapMode(
								requireTextureRole(plan.textureRoles, "detail-overlay"),
								spec.textureWrapMode,
							),
						)
					: null,
				family: "texture-rgba",
				rgbaTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-color").dataUse,
					spec.textureWrapMode,
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

function createTextureRecipes(options: {
	readonly materialRecipeSpecs: readonly MaterialRecipeSpec[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["textureRecipes"] {
	const recipes = new Map<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureRecipe
	>();
	for (const spec of options.materialRecipeSpecs) {
		for (const role of spec.plan.textureRoles) {
			const textureId = requireTextureRecipeId(
				options.registry,
				role.dataUse,
				resolveTextureRoleWrapMode(role, spec.textureWrapMode),
			);
			if (recipes.has(textureId)) {
				continue;
			}
			recipes.set(
				textureId,
				createTextureRecipe(
					role,
					resolveTextureRoleWrapMode(role, spec.textureWrapMode),
				),
			);
		}
	}
	return recipes;
}

function resolveTextureRoleWrapMode(
	role: ObjectVisualMaterialTextureUseRole,
	materialWrapMode: "clamp" | "repeat",
): "clamp" | "repeat" {
	if (role.role === "detail-overlay" && role.tiling > 1) {
		return "repeat";
	}
	return materialWrapMode;
}

function createTextureRecipe(
	role: ObjectVisualMaterialTextureUseRole,
	wrapMode: "clamp" | "repeat",
) {
	switch (role.role) {
		case "base-color":
		case "base-index":
		case "detail-overlay":
			return {
				dataUse: role.dataUse,
				wrapMode,
				source: {
					kind: "render-surface" as const,
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
					kind: "palette" as const,
					paletteId: role.palette.paletteId,
				},
				usage: "object-palette" as const,
			};
	}
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

function createTextureRecipeKeys(
	materialRecipeSpecs: readonly MaterialRecipeSpec[],
): readonly string[] {
	return [
		...new Set(
			materialRecipeSpecs.flatMap((spec) =>
				spec.plan.textureRoles.map((role) =>
					createTextureRecipeKey(
						role.dataUse,
						resolveTextureRoleWrapMode(role, spec.textureWrapMode),
					),
				),
			),
		),
	].sort();
}

function collectMaterialRecipeSpecs(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly payload: ObjectVisualSourcePayload;
}): readonly MaterialRecipeSpec[] {
	const materialByUseKey = new Map(
		options.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const materialSlots = new MaterialSlotIndex(options.payload);
	const specsByKey = new Map<string, MaterialRecipeSpec>();
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			for (const triangle of part.triangles) {
				const slot = materialSlots.resolveMaterialSlot(
					object.identity,
					part,
					triangle,
				);
				if (!slot) {
					continue;
				}
				const plan = materialByUseKey.get(
					createObjectVisualMaterialUseKey(
						slot.material,
						slot.paletteOverride,
						slot.paletteViews,
					),
				);
				if (!plan) {
					continue;
				}
				const textureWrapMode = resolveTextureWrapMode(
					triangle.materialVariantSignature ?? null,
				);
				const key = createMaterialRecipeKey(plan, textureWrapMode);
				specsByKey.set(key, { key, plan, textureWrapMode });
			}
		}
	}
	return [...specsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function createMaterialRecipeKey(
	plan: ObjectVisualMaterialPlan,
	textureWrapMode: "clamp" | "repeat",
): string {
	return [plan.materialUseKey, `wrap:${textureWrapMode}`].join("|");
}

function resolveTextureWrapMode(
	materialVariantSignature: string | null,
): "clamp" | "repeat" {
	return materialVariantSignature?.includes("sampler=repeat")
		? "repeat"
		: "clamp";
}

function requireTextureRecipeId(
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
	dataUse: MaterialTextureDataUseIdentity,
	wrapMode: "clamp" | "repeat",
): ObjectVisualTextureRecipeId {
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
	if (dataUse.kind === "prepared-palette-texture-use") {
		return [
			"palette",
			formatHex32(dataUse.palette.paletteId),
			`domain:${dataUse.domain}`,
			createPreparedPaletteReplacementsKey(dataUse.replacements),
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

function createPreparedPaletteReplacementsKey(
	replacements: readonly {
		readonly palette: { readonly paletteId: number };
		readonly offset: number;
		readonly count: number;
	}[],
): string {
	if (replacements.length === 0) {
		return "repl:none";
	}
	return [
		"repl",
		...replacements.map(
			(replacement) =>
				`${formatHex32(replacement.palette.paletteId)}@${replacement.offset}+${replacement.count}`,
		),
	].join(":");
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
		throw new Error(`Material recipe requires texture role ${role}.`);
	}
	return found;
}

class MaterialSlotIndex {
	readonly #slotsByObjectPartSurface = new Map<
		string,
		ObjectVisualMaterialSlotFacts
	>();

	constructor(payload: ObjectVisualSourcePayload) {
		for (const slot of payload.materialSlots) {
			for (const geometrySurfaceId of uniqueMaterialSlotSurfaceIds(slot)) {
				this.#slotsByObjectPartSurface.set(
					createMaterialSlotKey({
						geometrySurfaceId,
						materialVariantSignature: slot.materialVariantSignature,
						object: slot.object,
						partIndex: slot.identity.part.partIndex,
					}),
					slot,
				);
			}
		}
	}

	resolveMaterialSlot(
		object: ObjectVisualObjectIdentity,
		part: ObjectVisualPartSourceFacts,
		triangle: {
			readonly geometrySurfaceId: number | null;
			readonly materialVariantSignature: string | null;
		},
	):
		| ObjectVisualMaterialSlotFacts
		| ObjectVisualPartSourceFacts["materialSlots"][number]
		| null {
		if (triangle.geometrySurfaceId === null) {
			return null;
		}
		return (
			this.#slotsByObjectPartSurface.get(
				createMaterialSlotKey({
					geometrySurfaceId: triangle.geometrySurfaceId,
					materialVariantSignature: triangle.materialVariantSignature,
					object,
					partIndex: part.partIndex,
				}),
			) ??
			part.materialSlots.find(
				(slot) =>
					slot.geometrySurfaceId === triangle.geometrySurfaceId &&
					slot.materialVariantSignature === triangle.materialVariantSignature,
			) ??
			null
		);
	}
}

function uniqueMaterialSlotSurfaceIds(
	slot: ObjectVisualMaterialSlotFacts,
): readonly number[] {
	return [
		...new Set([
			slot.identity.geometrySurfaceId,
			slot.identity.materialSurfaceId,
		]),
	];
}

function findMissingGeometrySidecars(
	payload: ObjectVisualSourcePayload,
	geometrySidecars: readonly StaticObjectSourceGeometrySidecar[],
): readonly string[] {
	const sidecarKeys = new Set(
		geometrySidecars.map((sidecar) =>
			describeStaticObjectCanonicalGeometryIdentity(sidecar.identity),
		),
	);
	const missing: string[] = [];
	for (const source of payload.sourceAssets) {
		for (const part of source.parts) {
			const key = describeStaticObjectCanonicalGeometryIdentity(
				getStaticObjectCanonicalGeometryIdentity(part.geometry),
			);
			if (!sidecarKeys.has(key)) {
				missing.push(key);
			}
		}
	}
	return [...new Set(missing)].sort();
}

export function createObjectVisualSourcePartMatrix(
	object: ObjectVisualSourcePayload["objects"][number],
	part: ObjectVisualPartSourceFacts,
): Float32Array {
	let matrix = buildAcPlacementMatrix(object.localPlacement, AC_UNIT_SCALE);
	for (const placement of part.defaultPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(placement, AC_UNIT_SCALE),
		);
	}
	return multiplyMat4(
		matrix,
		createStaticObjectSourceScaleMatrix({
			x: object.sourceScale.x * part.scale.x,
			y: object.sourceScale.y * part.scale.y,
			z: object.sourceScale.z * part.scale.z,
		}),
	);
}

function createPartRecipeKey(
	object: ObjectVisualObjectIdentity,
	part: ObjectVisualPartSourceFacts,
): string {
	return [
		"static-object-part",
		createObjectKey(object),
		createSourceKey(part.source),
		`part:${part.partIndex}`,
	].join("|");
}

function createGeometryRecipeKey(part: ObjectVisualPartSourceFacts): string {
	return [
		"static-object-geometry",
		createSourceKey(part.source),
		createSourceKey(part.gfxObj),
		`part:${part.partIndex}`,
	].join("|");
}

function createGeometryBufferKey(
	identity: StaticObjectSourceGeometrySidecar["identity"],
): string {
	return describeStaticObjectCanonicalGeometryIdentity(identity);
}

function requireSource(
	payload: ObjectVisualSourcePayload,
	identity: ObjectVisualSourceIdentity,
): ObjectVisualSourcePayload["sourceAssets"][number] {
	const source = payload.sourceAssets.find(
		(candidate) =>
			createSourceKey(candidate.identity) === createSourceKey(identity),
	);
	if (!source) {
		throw new Error(
			`Static object visual bundle references missing source ${createSourceKey(identity)}.`,
		);
	}
	return source;
}

function createMaterialSlotKey(options: {
	readonly object: ObjectVisualObjectIdentity;
	readonly partIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialVariantSignature: string | null;
}): string {
	return [
		createObjectKey(options.object),
		`part:${options.partIndex}`,
		`surface:${options.geometrySurfaceId}`,
		`variant:${options.materialVariantSignature ?? "none"}`,
	].join("|");
}

function createObjectKey(object: ObjectVisualObjectIdentity): string {
	return [
		formatHex32(object.landblockId),
		object.objectKind,
		object.instanceId,
	].join(":");
}

function createSourceKey(source: ObjectVisualSourceIdentity): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function requireRegistryId<TKey, TId>(
	map: ReadonlyMap<TKey, TId>,
	key: TKey,
	subject: string,
): TId {
	const id = map.get(key);
	if (id === undefined) {
		throw new Error(`Missing object visual ${subject} id for ${String(key)}.`);
	}
	return id;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
