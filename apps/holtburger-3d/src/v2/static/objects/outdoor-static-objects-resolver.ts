import type {
	LandblockOutdoorPayloadDto,
	RegionRenderProfilePayloadDto,
} from "../../../lib/host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import {
	createHostAssetKey,
	parseHostAssetId,
} from "../../assets/keys";
import type {
	OutdoorStaticObjectsScopePayload,
	StaticMaterialSlotIdentity,
	StaticObjectInstanceFacts,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	OutdoorStaticBvhFacts,
	StaticObjectPartIdentity,
	RegionDetailRoleFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import { createSurfaceTextureIdentity } from "../terrain/terrain-identities";
import {
	createPaletteCacheKey,
	createSourceCacheKey,
	createStaticObjectSourceIdentity,
	createTextureRefCacheKey,
	resolveStaticObjectSourceClosure,
	resolveStaticObjectSurfaceTextureRef,
} from "./static-object-source-closure";

type OutdoorStaticPreparedPayload =
	| LandblockOutdoorPayloadDto
	| RegionRenderProfilePayloadDto;

interface LoadedPayload<
	TKind extends OutdoorStaticPreparedPayload["kind"] =
		OutdoorStaticPreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<
		OutdoorStaticPreparedPayload,
		{ readonly kind: TKind }
	>;
}

interface OutdoorStaticResolveContext {
	readonly assetService: PreparedAssetReader;
}

export interface OutdoorStaticObjectsResolverOptions {
	readonly assetService: PreparedAssetReader;
}

export class OutdoorStaticObjectsResolver {
	readonly #assetService: PreparedAssetReader;

	constructor(options: OutdoorStaticObjectsResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (
			!isOutdoorStaticObjectDomain(job.domain) ||
			job.scope.kind !== "landblock"
		) {
			throw new Error(
				`Outdoor static object resolver only supports outdoor static landblock jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}
		const domain = job.domain;
		const context: OutdoorStaticResolveContext = {
			assetService: this.#assetService,
		};

		const landblock = await this.#loadPayload(
			context,
			createHostAssetKey("landblock-outdoor", job.scope.landblockId),
			"landblock-outdoor",
		);
		const selectedObjects = landblock.payload.statics.filter((object) =>
			shouldIncludeOutdoorStaticObject(domain, object.kind),
		);
		const regionRenderProfile = await this.#loadPayload(
			context,
			createHostAssetKey(
				"region-render-profile",
				landblock.payload.regionNumber,
			),
			"region-render-profile",
		);
		const sourceResolution = await resolveStaticObjectSourceClosure({
			assetService: context.assetService,
			sourceAssetIds: selectedObjects.map((object) => object.sourceAssetId),
		});
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
						context,
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
		const objectsByInstanceId = new Map(
			objects.map((object) => [object.identity.instanceId, object]),
		);
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
				outdoorBvh: createOutdoorStaticBvhFacts(
					landblock.payload.outdoorBvh,
					objectsByInstanceId,
				),
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

	async #resolveRegionDetailTextureRefs(options: {
		readonly context: OutdoorStaticResolveContext;
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
				await resolveStaticObjectSurfaceTextureRef({
					assetService: options.context.assetService,
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

	async #loadPayload<TKind extends OutdoorStaticPreparedPayload["kind"]>(
		context: OutdoorStaticResolveContext,
		key: HostAssetKey,
		expectedKind: TKind,
	): Promise<LoadedPayload<TKind>> {
		const asset = await context.assetService.requestPreparedAsset(key);
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

function createOutdoorStaticBvhFacts(
	bvh: LandblockOutdoorPayloadDto["outdoorBvh"],
	objectsByInstanceId: ReadonlyMap<string, StaticObjectInstanceFacts>,
): OutdoorStaticBvhFacts | null {
	if (!bvh) {
		return null;
	}

	return {
		coordinateSpace: "landblock-render-local",
		items: bvh.items.map((item, bvhItemIndex) => ({
			bvhItemIndex,
			instanceId: item.instanceId,
			kind: item.kind,
			object: objectsByInstanceId.get(item.instanceId) ?? null,
		})),
		nodes: bvh.nodes,
	};
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

	return payload as Extract<
		OutdoorStaticPreparedPayload,
		{ readonly kind: TKind }
	>;
}
