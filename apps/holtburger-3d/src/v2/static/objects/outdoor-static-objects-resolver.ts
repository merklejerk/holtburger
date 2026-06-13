import type {
	GfxObjPayloadDto,
	LandblockOutdoorPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../../../lib/host/contracts";
import type { AssetService, HostAssetKey, PreparedAsset } from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	parseHostAssetId,
} from "../../assets/keys";
import type {
	OutdoorStaticObjectsScopePayload,
	PaletteIdentity,
	RenderSurfaceIdentity,
	StaticMaterialSlotIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectInstanceFacts,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteViewFacts,
	StaticObjectPartIdentity,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectPartSourceFacts,
	RegionDetailRoleFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
	StaticObjectPaletteSourceFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticResolverJob,
	StaticScopePayload,
	SurfaceTextureIdentity,
} from "../contracts";
import {
	createPaletteIdentity,
	createRenderSurfaceIdentity,
	createSurfaceTextureIdentity,
} from "../terrain/terrain-identities";

type OutdoorStaticPreparedPayload =
	| GfxObjPayloadDto
	| LandblockOutdoorPayloadDto
	| MaterialRecipePayloadDto
	| PalettePayloadDto
	| RegionRenderProfilePayloadDto
	| RenderSurfacePayloadDto
	| SetupAppearancePayloadDto
	| SetupModelPayloadDto
	| SurfaceTexturePayloadDto;

interface LoadedPayload<
	TKind extends OutdoorStaticPreparedPayload["kind"] =
		OutdoorStaticPreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }>;
}

interface SourceResolution {
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly sourceRevision: number;
}

interface StaticObjectMaterialSlotInput {
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
	readonly materialId: number;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: StaticObjectPaletteViewFacts["palette"] | null;
	readonly paletteViews: readonly StaticObjectPaletteViewFacts[];
}

export interface OutdoorStaticObjectsResolverOptions {
	readonly assetService: AssetService;
}

export class OutdoorStaticObjectsResolver {
	readonly #assetService: AssetService;

	constructor(options: OutdoorStaticObjectsResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (!isOutdoorStaticObjectDomain(job.domain) || job.scope.kind !== "landblock") {
			throw new Error(
				`Outdoor static object resolver only supports outdoor static landblock jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}
		const domain = job.domain;

		const landblock = await this.#loadPayload(
			createHostAssetKey("landblock-outdoor", job.scope.landblockId),
			"landblock-outdoor",
		);
		const selectedObjects = landblock.payload.statics.filter((object) =>
			shouldIncludeOutdoorStaticObject(domain, object.kind),
		);
		const regionRenderProfile = await this.#loadPayload(
			createHostAssetKey("region-render-profile", landblock.payload.regionNumber),
			"region-render-profile",
		);
		const sourceResolution = await this.#resolveSourceAssets(
			selectedObjects.map((object) => object.sourceAssetId),
		);
		const paletteSources = new Map(
			sourceResolution.paletteSources.map((source) => [
				createPaletteCacheKey(source.palette),
				source,
			]),
		);
		const textureRefs = new Map(
			sourceResolution.textureRefs.map((ref) => [
				createTextureRefCacheKey(ref),
				ref,
			]),
		);
		const missingRefs = [...sourceResolution.missingRefs];
		const detailRoles = createRegionDetailRolesForDomain(
			domain,
			regionRenderProfile.payload,
		);
		const detailTextureRevision =
			detailRoles.length === 0
				? 0
				: await this.#resolveRegionDetailTextureRefs({
						missingRefs,
						paletteSources,
						profile: regionRenderProfile.payload,
						textureRefs,
					});
		const sourceByKey = new Map(
			sourceResolution.sourceAssets.map((source) => [
				createSourceCacheKey(source.identity),
				source,
			]),
		);
		const objects = selectedObjects
			.map((object): StaticObjectInstanceFacts => {
				const source = createStaticObjectSourceIdentity(
					parseHostAssetId(object.sourceAssetId),
				);
				return {
					debug: { sourceAssetId: object.sourceAssetId },
					generated: object.generated
						? {
								sceneId: object.generated.sceneId,
								sceneTemplateIndex: object.generated.sceneTemplateIndex,
								terrainIndex: object.generated.terrainIndex,
							}
						: null,
					identity: createStaticObjectInstanceIdentity({
						instanceId: object.instanceId,
						landblockId: landblock.payload.landblockId,
						objectKind: object.kind,
					}),
					instanceBounds: object.instanceBounds,
					localPlacement: object.localPlacement,
					portalCount: object.building?.portals.length ?? 0,
					source,
					sourceBounds: object.sourceBounds,
					sourceIndex: object.sourceIndex,
					sourceScale: object.sourceScale,
				};
			})
			.filter((object) => sourceByKey.has(createSourceCacheKey(object.source)));
		const materialSlots = createObjectMaterialSlotFacts({
			objects,
			sourceByKey,
		});
		const scope: OutdoorStaticObjectsScopePayload = {
			domain,
			kind: "outdoor-static-objects",
			landblock: {
				kind: "landblock-source",
				landblockId: landblock.payload.landblockId,
				source: "outdoor",
			},
			materialSlots,
			materialSources: sourceResolution.materialSources,
			missingRefs,
			objects,
			paletteSources: [...paletteSources.values()],
			regionRenderProfile: {
				detailRoles,
				identity: {
					kind: "region-render-profile",
					regionNumber: landblock.payload.regionNumber,
				},
			},
			sourceAssets: sourceResolution.sourceAssets,
			sourceSpatial: {
				bounds: landblock.payload.terrain.bounds,
				coordinateSpace: "landblock-render-local",
				outdoorBvhItemCount: landblock.payload.outdoorBvh?.items.length ?? 0,
				outdoorBvhNodeCount: landblock.payload.outdoorBvh?.nodes.length ?? 0,
			},
			textureRefs: [...textureRefs.values()],
		};

		return {
			job,
			scope,
			sourceRevision: Math.max(
				landblock.asset.revision,
				regionRenderProfile.asset.revision,
				sourceResolution.sourceRevision,
				detailTextureRevision,
			),
		};
	}

	async #resolveSourceAssets(
		sourceAssetIds: readonly string[],
	): Promise<SourceResolution> {
		const sourceAssets = new Map<string, StaticObjectSourceAssetFacts>();
		const materialSources = new Map<string, StaticObjectMaterialSourceFacts>();
		const paletteSources = new Map<string, StaticObjectPaletteSourceFacts>();
		const textureRefs = new Map<string, StaticObjectTextureRefFacts>();
		const missingRefs: StaticResourceIdentity[] = [];
		let sourceRevision = 0;

		for (const sourceAssetId of uniqueSorted(sourceAssetIds)) {
			const sourceKey = parseHostAssetId(sourceAssetId);
			const identity = createStaticObjectSourceIdentity(sourceKey);

			try {
				const source = await this.#loadRenderableSource(sourceKey);
				sourceRevision = Math.max(sourceRevision, source.asset.revision);
				const facts = await this.#createSourceAssetFacts({
					identity,
					materialSources,
					missingRefs,
					paletteSources,
					source,
					textureRefs,
				});
				sourceAssets.set(createSourceCacheKey(identity), facts);
				sourceRevision = Math.max(sourceRevision, facts.partCount);
			} catch {
				missingRefs.push(identity);
			}
		}

		return {
			materialSources: [...materialSources.values()],
			missingRefs,
			paletteSources: [...paletteSources.values()],
			sourceAssets: [...sourceAssets.values()],
			sourceRevision,
			textureRefs: [...textureRefs.values()],
		};
	}

	async #createSourceAssetFacts(options: {
		readonly identity: StaticObjectSourceIdentity;
		readonly source: LoadedPayload<"gfx-obj" | "setup-model">;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<StaticObjectSourceAssetFacts> {
		const parts =
			options.source.payload.kind === "gfx-obj"
				? await this.#createDirectGfxParts({
						gfxObjAssetId: options.source.asset.sourceAssetId,
						gfxObj: options.source.payload,
						materialSources: options.materialSources,
						missingRefs: options.missingRefs,
						paletteSources: options.paletteSources,
						source: options.identity,
						textureRefs: options.textureRefs,
					})
				: await this.#createSetupModelParts({
						materialSources: options.materialSources,
						missingRefs: options.missingRefs,
						paletteSources: options.paletteSources,
						setupModel: options.source.payload,
						source: options.identity,
						textureRefs: options.textureRefs,
					});

		return {
			bounds: mergePartBounds(parts),
			debug: { sourceAssetId: options.source.asset.sourceAssetId },
			identity: options.identity,
			invalidPolygonCount: sum(parts, (part) => part.invalidPolygonCount),
			materialSlotCount: sum(parts, (part) => part.materialSlotCount),
			partCount: parts.length,
			parts,
			physicsPolygonCount: sum(parts, (part) => part.physicsPolygonCount),
			renderTriangleCount: sum(parts, (part) => part.renderTriangleCount),
			skippedPolygonCount: sum(parts, (part) => part.skippedPolygonCount),
			sourceAssetKind: options.identity.sourceAssetKind,
		};
	}

	async #createDirectGfxParts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly gfxObjAssetId: string;
		readonly gfxObj: GfxObjPayloadDto;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartSourceFacts[]> {
		return [
			await this.#createGfxPartFacts({
				defaultPlacements: [],
				gfxObj: options.gfxObj,
				gfxObjAssetId: options.gfxObjAssetId,
				materialSources: options.materialSources,
				missingRefs: options.missingRefs,
				paletteSources: options.paletteSources,
				partIndex: 0,
				scale: UNIT_SCALE,
				source: options.source,
				textureRefs: options.textureRefs,
			}),
		];
	}

	async #createSetupModelParts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly setupModel: SetupModelPayloadDto;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartSourceFacts[]> {
		const setupAppearance = await this.#tryLoadSetupAppearance(
			options.setupModel.setupModelId,
			options.missingRefs,
		);
		const parts = setupAppearance?.payload.parts ?? options.setupModel.parts;
		const paletteOverride =
			setupAppearance?.payload.paletteId == null
				? null
				: createPaletteIdentity(setupAppearance.payload.paletteId);
		const paletteViews = createStaticObjectPaletteViews(
			setupAppearance?.payload.subPalettes ?? [],
		);
		if (paletteOverride) {
			await this.#loadPalette(
				paletteOverride,
				options.paletteSources,
				options.missingRefs,
			);
		}
		await this.#loadPaletteViews(
			paletteViews,
			options.paletteSources,
			options.missingRefs,
		);
		const facts: StaticObjectPartSourceFacts[] = [];

		for (const part of parts) {
			const gfxObjAssetId = part.gfxObjAssetId;
			const gfxObjIdentity = createStaticObjectSourceIdentity(
				parseHostAssetId(gfxObjAssetId),
			);
			let gfxObj: LoadedPayload<"gfx-obj">;
			try {
				gfxObj = await this.#loadPayload(parseHostAssetId(gfxObjAssetId), "gfx-obj");
			} catch {
				options.missingRefs.push(gfxObjIdentity);
				continue;
			}

			const setupPart = options.setupModel.parts.find(
				(candidate) => candidate.partIndex === part.partIndex,
			);
			facts.push(
				await this.#createGfxPartFacts({
					defaultPlacements: deriveSetupPartDefaultPlacements(
						options.setupModel,
						part.partIndex,
					),
					gfxObj: gfxObj.payload,
					gfxObjAssetId,
					materialSlots:
						"materialSlots" in part
							? expandStaticObjectMaterialVariants({
									gfxObj: gfxObj.payload,
									materialSlots: part.materialSlots.map((slot) => ({
										geometrySurfaceId: slot.slotIndex,
										materialId: parseMaterialAssetId(slot.materialAssetId),
										materialSurfaceId: slot.surfaceId,
										materialVariantSignature: null,
										paletteOverride,
										paletteViews,
										slotIndex: slot.slotIndex,
									})),
								})
							: undefined,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					paletteSources: options.paletteSources,
					partIndex: part.partIndex,
					scale: setupPart?.scale ?? UNIT_SCALE,
					source: options.source,
					textureRefs: options.textureRefs,
				}),
			);
		}

		return facts;
	}

	async #createGfxPartFacts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly gfxObjAssetId: string;
		readonly gfxObj: GfxObjPayloadDto;
		readonly partIndex: number;
		readonly defaultPlacements: readonly StaticObjectPartSourceFacts["defaultPlacements"][number][];
		readonly scale: StaticObjectPartSourceFacts["scale"];
		readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<StaticObjectPartSourceFacts> {
		const gfxObj = createStaticObjectSourceIdentity(
			parseHostAssetId(options.gfxObjAssetId),
		);
		const materialSlots = await this.#createMaterialSlotFacts({
			gfxObj: options.gfxObj,
			materialSlots: options.materialSlots,
			materialSources: options.materialSources,
			missingRefs: options.missingRefs,
			paletteSources: options.paletteSources,
			textureRefs: options.textureRefs,
		});

		return {
			bounds: options.gfxObj.renderGeometry.bounds,
			defaultPlacements: options.defaultPlacements,
			gfxObj,
			invalidPolygonCount: options.gfxObj.renderGeometry.invalidPolygons.length,
			materialSlotCount: materialSlots.length,
			materialSlots,
			normals: toFloat32Array(options.gfxObj.renderGeometry.normals),
			partIndex: options.partIndex,
			physicsPolygonCount: options.gfxObj.physicsWitness.polygonCount,
			positions: toFloat32Array(options.gfxObj.renderGeometry.positions),
			renderTriangleCount: options.gfxObj.renderGeometry.triangleCount,
			scale: options.scale,
			skippedPolygonCount: options.gfxObj.renderGeometry.skippedPolygonCount,
			source: options.source,
			texCoords: toFloat32Array(options.gfxObj.renderGeometry.uvs),
			triangles: options.gfxObj.renderGeometry.triangles.map((triangle) => ({
				firstVertex: triangle.firstVertex,
				geometrySurfaceId: triangle.surfaceId,
				materialVariantSignature: triangle.materialVariantSignature ?? null,
				polygonId: triangle.polygonId,
			})),
		};
	}

	async #createMaterialSlotFacts(options: {
		readonly gfxObj: GfxObjPayloadDto;
		readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartMaterialSlotFacts[]> {
		const materialSlots =
			options.materialSlots ??
			expandStaticObjectMaterialVariants({
				gfxObj: options.gfxObj,
				materialSlots: options.gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
					geometrySurfaceId: slotIndex,
					materialId: surfaceId,
					materialSurfaceId: surfaceId,
					materialVariantSignature: null,
					paletteOverride: null,
					paletteViews: [],
					slotIndex,
				})),
			});
		const slots = await Promise.all(
			materialSlots.map(async (slot) => {
				const material = createStaticMaterialSourceIdentity(slot.materialId);
				await this.#loadMaterialSource({
					material,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					paletteSources: options.paletteSources,
					textureRefs: options.textureRefs,
				});
				return {
					material,
					geometrySurfaceId: slot.geometrySurfaceId,
					materialSurfaceId: slot.materialSurfaceId,
					materialVariantSignature: slot.materialVariantSignature,
					paletteOverride: slot.paletteOverride,
					paletteViews: slot.paletteViews,
					slotIndex: slot.slotIndex,
				};
			}),
		);

		return slots;
	}

	async #loadMaterialSource(options: {
		readonly material: StaticMaterialSourceIdentity;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<void> {
		const key = createMaterialCacheKey(options.material);
		if (options.materialSources.has(key)) {
			return;
		}

		let material: LoadedPayload<"material-recipe">;
		try {
			material = await this.#loadPayload(
				createHostAssetKey("material", options.material.materialId),
				"material-recipe",
			);
		} catch {
			options.missingRefs.push(options.material);
			return;
		}

		const source =
			material.payload.source.kind === "solid-color"
				? {
						argb: material.payload.source.argb,
						kind: "solid-color" as const,
					}
				: {
						kind: "texture" as const,
						palette:
							material.payload.source.paletteId === null
								? null
								: createPaletteIdentity(material.payload.source.paletteId),
						renderSurfaceDefaultPalettes:
							material.payload.source.renderSurfaceDefaultPaletteIds.map(
								createPaletteIdentity,
							),
						selectedRenderSurface:
							material.payload.source.selectedRenderSurfaceId === null
								? null
								: createRenderSurfaceIdentity(
										material.payload.source.selectedRenderSurfaceId,
									),
						texture: createSurfaceTextureIdentity(
							material.payload.source.surfaceTextureId,
						),
					};

		options.materialSources.set(key, {
			diffuse: material.payload.diffuse,
			identity: options.material,
			luminosity: material.payload.luminosity,
			source,
			surfaceId: material.payload.surfaceId,
			surfaceType: material.payload.surfaceType,
			translucency: material.payload.translucency,
		});

		if (source.kind === "texture" && source.palette) {
			await this.#loadPalette(
				source.palette,
				options.paletteSources,
				options.missingRefs,
			);
		}

		await this.#resolveMaterialTextureRefs(
			material.payload,
			options.paletteSources,
			options.textureRefs,
			options.missingRefs,
		);
	}

	async #resolveMaterialTextureRefs(
		material: MaterialRecipePayloadDto,
		paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
		textureRefs: Map<string, StaticObjectTextureRefFacts>,
		missingRefs: StaticResourceIdentity[],
	): Promise<void> {
		if (material.source.kind !== "texture") {
			return;
		}

		await this.#resolveSurfaceTextureRef({
			missingRefs,
			palette:
				material.source.paletteId === null
					? null
					: createPaletteIdentity(material.source.paletteId),
			paletteSources,
			selectedRenderSurfaceId: material.source.selectedRenderSurfaceId,
			texture: createSurfaceTextureIdentity(material.source.surfaceTextureId),
			textureRefs,
		});
	}

	async #resolveRegionDetailTextureRefs(options: {
		readonly profile: RegionRenderProfilePayloadDto;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<number> {
		let sourceRevision = 0;
		for (const role of Object.values(options.profile.detailRoles)) {
			if (!role) {
				continue;
			}
			sourceRevision = Math.max(
				sourceRevision,
				await this.#resolveSurfaceTextureRef({
					missingRefs: options.missingRefs,
					palette: null,
					paletteSources: options.paletteSources,
					selectedRenderSurfaceId: null,
					texture: createSurfaceTextureIdentity(role.textureDid),
					textureRefs: options.textureRefs,
				}),
			);
		}
		return sourceRevision;
	}

	async #resolveSurfaceTextureRef(options: {
		readonly texture: SurfaceTextureIdentity;
		readonly selectedRenderSurfaceId: number | null;
		readonly palette: PaletteIdentity | null;
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<number> {
		let surfaceTexture: LoadedPayload<"surface-texture">;
		try {
			surfaceTexture = await this.#loadPayload(
				createHostAssetKey("surface-texture", options.texture.surfaceTextureId),
				"surface-texture",
			);
		} catch {
			options.missingRefs.push(options.texture);
			return 0;
		}

		const renderSurfaceId =
			options.selectedRenderSurfaceId ??
			surfaceTexture.payload.selectedRenderSurfaceId ??
			surfaceTexture.payload.renderSurfaceIds[0] ??
			null;
		const renderSurface =
			renderSurfaceId === null ? null : createRenderSurfaceIdentity(renderSurfaceId);
		let palette = options.palette;

		options.textureRefs.set(
			createTextureRefCacheKey({
				role: "surface-texture",
				texture: options.texture,
			}),
			{
				palette,
				renderSurface,
				role: "surface-texture",
				texture: options.texture,
			},
		);

		if (renderSurface === null) {
			return 0;
		}

		try {
			const loadedRenderSurface = await this.#loadPayload(
				createHostAssetKey("render-surface", renderSurface.renderSurfaceId),
				"render-surface",
			);
			palette =
				palette ??
				(loadedRenderSurface.payload.defaultPaletteId === null
					? null
					: createPaletteIdentity(loadedRenderSurface.payload.defaultPaletteId));
			options.textureRefs.set(
				createTextureRefCacheKey({ role: "render-surface", renderSurface }),
				{
					format: loadedRenderSurface.payload.format,
					formatRaw: loadedRenderSurface.payload.formatRaw,
					height: loadedRenderSurface.payload.height,
					indexedMaxIndex: scanIndexedMaxIndex(
						loadedRenderSurface.payload.sourceBytes,
						loadedRenderSurface.payload.formatRaw,
					),
					palette,
					renderSurface,
					role: "render-surface",
					width: loadedRenderSurface.payload.width,
				},
			);
			if (palette) {
				await this.#loadPalette(
					palette,
					options.paletteSources,
					options.missingRefs,
				);
			}
			return loadedRenderSurface.payload.sourceByteLength;
		} catch {
			options.missingRefs.push(renderSurface);
			return 0;
		}
	}

	async #loadPalette(
		palette: PaletteIdentity,
		paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
		missingRefs: StaticResourceIdentity[],
	): Promise<void> {
		const key = createPaletteCacheKey(palette);
		if (paletteSources.has(key)) {
			return;
		}
		try {
			const loaded = await this.#loadPayload(
				createHostAssetKey("palette", palette.paletteId),
				"palette",
			);
			paletteSources.set(key, {
				colorCount: loaded.payload.colorCount,
				palette,
			});
		} catch {
			missingRefs.push(palette);
		}
	}

	async #loadPaletteViews(
		paletteViews: readonly StaticObjectPaletteViewFacts[],
		paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
		missingRefs: StaticResourceIdentity[],
	): Promise<void> {
		for (const paletteView of paletteViews) {
			await this.#loadPalette(paletteView.palette, paletteSources, missingRefs);
		}
	}

	async #tryLoadSetupAppearance(
		setupModelId: number,
		missingRefs: StaticResourceIdentity[],
	): Promise<LoadedPayload<"setup-appearance"> | null> {
		const identity: StaticObjectSourceIdentity = {
			kind: "static-object-source",
			sourceAssetKind: "setup-appearance",
			sourceDid: setupModelId,
		};
		try {
			return await this.#loadPayload(
				createHostAssetKey("setup-appearance", setupModelId),
				"setup-appearance",
			);
		} catch {
			missingRefs.push(identity);
			return null;
		}
	}

	async #loadRenderableSource(
		key: HostAssetKey,
	): Promise<LoadedPayload<"gfx-obj" | "setup-model">> {
		if (key.kind !== "gfx-obj" && key.kind !== "setup-model") {
			throw new Error(
				`Outdoor static object source must be gfx-obj or setup-model, got ${describeHostAssetKey(key)}.`,
			);
		}

		return this.#loadPayload(key, key.kind);
	}

	async #loadPayload<TKind extends OutdoorStaticPreparedPayload["kind"]>(
		key: HostAssetKey,
		expectedKind: TKind,
	): Promise<LoadedPayload<TKind>> {
		const asset = await this.#assetService.requestPreparedAsset(key);
		const payload = requirePreparedPayloadKind(asset, expectedKind);
		return { asset, payload };
	}
}

function isOutdoorStaticObjectDomain(
	domain: StaticResolverJob["domain"],
): domain is OutdoorStaticObjectsScopePayload["domain"] {
	return domain === "outdoor-buildings" || domain === "outdoor-detail";
}

function shouldIncludeOutdoorStaticObject(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	objectKind: LandblockOutdoorPayloadDto["statics"][number]["kind"],
): boolean {
	return domain === "outdoor-buildings"
		? objectKind === "building"
		: objectKind === "generated-scenery" || objectKind === "explicit-object";
}

function createObjectMaterialSlotFacts(options: {
	readonly objects: readonly StaticObjectInstanceFacts[];
	readonly sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>;
}): readonly StaticObjectMaterialSlotFacts[] {
	return options.objects.flatMap((object) => {
		const source = options.sourceByKey.get(createSourceCacheKey(object.source));
		if (!source) {
			return [];
		}

		return source.parts.flatMap((part) =>
			part.materialSlots.map((slot) => {
				const partIdentity: StaticObjectPartIdentity = {
					kind: "static-object-part",
					object: object.identity,
					partIndex: part.partIndex,
				};
				const identity: StaticMaterialSlotIdentity = {
					kind: "static-material-slot",
					part: partIdentity,
					geometrySurfaceId: slot.geometrySurfaceId,
					materialSurfaceId: slot.materialSurfaceId,
					slotIndex: slot.slotIndex,
				};
				return {
					gfxObj: part.gfxObj,
					identity,
					material: slot.material,
					materialVariantSignature: slot.materialVariantSignature,
					object: object.identity,
					paletteOverride: slot.paletteOverride,
					paletteViews: slot.paletteViews,
					source: object.source,
				};
			}),
		);
	});
}

function expandStaticObjectMaterialVariants(options: {
	readonly gfxObj: GfxObjPayloadDto;
	readonly materialSlots: readonly Omit<
		StaticObjectMaterialSlotInput,
		"materialVariantSignature"
	>[];
}): readonly StaticObjectMaterialSlotInput[] {
	const variantsByGeometrySurface = collectGeometryMaterialVariants(
		options.gfxObj,
	);

	return options.materialSlots.flatMap((slot) => {
		const variants = variantsByGeometrySurface.get(slot.geometrySurfaceId);
		if (!variants || variants.size === 0) {
			return [{ ...slot, materialVariantSignature: null }];
		}

		return [...variants]
			.sort(compareMaterialVariantSignatures)
			.map((materialVariantSignature) => ({
				...slot,
				materialVariantSignature,
			}));
	});
}

function collectGeometryMaterialVariants(
	gfxObj: GfxObjPayloadDto,
): ReadonlyMap<number, ReadonlySet<string | null>> {
	const variantsByGeometrySurface = new Map<number, Set<string | null>>();

	for (const triangle of gfxObj.renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const variants =
			variantsByGeometrySurface.get(triangle.surfaceId) ??
			new Set<string | null>();
		variants.add(triangle.materialVariantSignature ?? null);
		variantsByGeometrySurface.set(triangle.surfaceId, variants);
	}

	return variantsByGeometrySurface;
}

function compareMaterialVariantSignatures(
	left: string | null,
	right: string | null,
): number {
	return (left ?? "").localeCompare(right ?? "");
}

function createStaticObjectSourceIdentity(key: HostAssetKey): StaticObjectSourceIdentity {
	if (
		key.kind !== "gfx-obj" &&
		key.kind !== "setup-model" &&
		key.kind !== "setup-appearance"
	) {
		throw new Error(
			`Static object source identity expected gfx/setup asset key, received ${describeHostAssetKey(
				key,
			)}.`,
		);
	}

	return {
		kind: "static-object-source",
		sourceAssetKind: key.kind,
		sourceDid: Number.parseInt(key.id, 16) >>> 0,
	};
}

function createStaticObjectInstanceIdentity(options: {
	readonly landblockId: number;
	readonly instanceId: string;
	readonly objectKind: StaticObjectInstanceIdentity["objectKind"];
}): StaticObjectInstanceIdentity {
	return {
		kind: "static-object-instance",
		instanceId: options.instanceId,
		landblockId: options.landblockId,
		objectKind: options.objectKind,
	};
}

function createStaticMaterialSourceIdentity(
	materialId: number,
): StaticMaterialSourceIdentity {
	return {
		kind: "static-material-source",
		materialId,
	};
}

function createRegionDetailRoles(
	profile: RegionRenderProfilePayloadDto,
): readonly RegionDetailRoleFacts[] {
	return Object.entries(profile.detailRoles).flatMap(([role, entry]) => {
		if (!entry) {
			return [];
		}

		return [
			{
				fadeFar: entry.fadeFar,
				fadeNear: entry.fadeNear,
				role: role as RegionDetailRoleFacts["role"],
				texture: createSurfaceTextureIdentity(entry.textureDid),
				tiling: entry.tiling,
			},
		];
	});
}

function createRegionDetailRolesForDomain(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	profile: RegionRenderProfilePayloadDto,
): readonly RegionDetailRoleFacts[] {
	if (domain === "outdoor-detail") {
		return [];
	}

	return createRegionDetailRoles(profile);
}

function createStaticObjectPaletteViews(
	subPalettes: readonly SetupAppearancePayloadDto["subPalettes"][number][],
): readonly StaticObjectPaletteViewFacts[] {
	return subPalettes
		.map((subPalette) => ({
			firstIndex: subPalette.offset,
			indexCount: subPalette.numColors,
			palette: createPaletteIdentity(subPalette.subId),
		}))
		.sort(
			(left, right) =>
				left.palette.paletteId - right.palette.paletteId ||
				left.firstIndex - right.firstIndex ||
				left.indexCount - right.indexCount,
		);
}

function parseMaterialAssetId(assetId: string): number {
	const key = parseHostAssetId(assetId);
	if (key.kind !== "material") {
		throw new Error(`Expected material asset route, received ${assetId}.`);
	}

	return Number.parseInt(key.id, 16) >>> 0;
}

function deriveSetupPartDefaultPlacements(
	setupModel: SetupModelPayloadDto,
	partIndex: number,
): readonly StaticObjectPartSourceFacts["defaultPlacements"][number][] {
	const byPart = setupModel.placementSets
		.flatMap((set) => set.localPlacements)
		.filter((_, index) => index === partIndex);
	const location = setupModel.connectionPoints
		.concat(setupModel.holdingLocations)
		.filter((entry) => entry.partId === partIndex)
		.map((entry) => entry.localPlacement);
	return [...byPart, ...location];
}

function toFloat32Array(values: readonly number[] | Float32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

function mergePartBounds(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticObjectSourceAssetFacts["bounds"] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const part of parts) {
		if (!part.bounds) {
			continue;
		}
		minX = Math.min(minX, part.bounds.min.x);
		minY = Math.min(minY, part.bounds.min.y);
		minZ = Math.min(minZ, part.bounds.min.z);
		maxX = Math.max(maxX, part.bounds.max.x);
		maxY = Math.max(maxY, part.bounds.max.y);
		maxZ = Math.max(maxZ, part.bounds.max.z);
	}

	if (!Number.isFinite(minX)) {
		return null;
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function sum<T>(values: readonly T[], getValue: (value: T) => number): number {
	return values.reduce((total, value) => total + getValue(value), 0);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort();
}

function createSourceCacheKey(identity: StaticObjectSourceIdentity): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}

function createMaterialCacheKey(identity: StaticMaterialSourceIdentity): string {
	return `${identity.materialId}`;
}

function createPaletteCacheKey(identity: PaletteIdentity): string {
	return `${identity.paletteId}`;
}

function createTextureRefCacheKey(
	ref:
		| { readonly role: "surface-texture"; readonly texture: SurfaceTextureIdentity }
		| { readonly role: "render-surface"; readonly renderSurface: RenderSurfaceIdentity },
): string {
	return ref.role === "surface-texture"
		? `${ref.role}:${ref.texture.surfaceTextureId}`
		: `${ref.role}:${ref.renderSurface.renderSurfaceId}`;
}

function requirePreparedPayloadKind<
	TKind extends OutdoorStaticPreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }> {
	const payload = asset.payload as OutdoorStaticPreparedPayload;
	if (payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${payload.kind}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }>;
}

const UNIT_SCALE = { x: 1, y: 1, z: 1 };

const PIXEL_FORMAT_P8 = 0x29;
const PIXEL_FORMAT_INDEX16 = 0x65;

function scanIndexedMaxIndex(bytes: Uint8Array, formatRaw: number): number | null {
	if (formatRaw === PIXEL_FORMAT_P8) {
		let maxIndex = 0;
		for (const index of bytes) {
			maxIndex = Math.max(maxIndex, index);
		}
		return maxIndex;
	}
	if (formatRaw !== PIXEL_FORMAT_INDEX16) {
		return null;
	}
	if (bytes.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
		throw new Error(
			`Index16 render surface byte length ${bytes.byteLength} is not 16-bit aligned.`,
		);
	}
	let maxIndex = 0;
	for (let offset = 0; offset < bytes.byteLength; offset += 2) {
		const index = bytes[offset] | ((bytes[offset + 1] ?? 0) << 8);
		maxIndex = Math.max(maxIndex, index);
	}
	return maxIndex;
}
