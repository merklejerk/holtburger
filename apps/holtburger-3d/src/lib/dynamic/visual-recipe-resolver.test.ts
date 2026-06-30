import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { createHostAssetKey, formatHostAssetId } from "../assets/keys";
import type { SetupModelPayloadDto } from "../host/contracts";
import type {
	OutdoorStaticObjectLayerDomain,
	StaticLayerPeerRecordOwner,
} from "../static/contracts";
import type {
	DynamicEntityAppearanceOverride,
	DynamicEntityRecipeSource,
	DynamicEntityTransformState,
	DynamicVisualMaterialPolicy,
} from "./contracts";
import { createDynamicVisualResourceId } from "./contracts";
import { resolveDynamicVisualRecipe } from "./visual-recipe-resolver";

describe("dynamic visual recipe resolver", () => {
	it("resolves runtime-authored setup/default-animation sources into the shared visual recipe shape", async () => {
		const setupModelId = 0x020003e5;
		const animationId = 0x03000042;
		const assetReader = new FixturePreparedAssetReader([
			createSetupModelAsset({
				animationId,
				setupModelId,
			}),
			createAnimationAsset(animationId),
		]);

		const recipe = await resolveDynamicVisualRecipe({
			animationSelection: { kind: "setup-default" },
			assetReader,
			baseTransform: createTransform(),
			entityId: "runtime:1",
			materialPolicy: createMaterialPolicy("runtime:1"),
			modelData: null,
			setupModelId,
			source: {
				kind: "runtime-authored",
				runtimeEntityId: "runtime:1",
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			},
		});

		expect(recipe.source.kind).toBe("runtime-authored");
		expect(recipe.visual.setupModel.identity).toEqual({
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: setupModelId,
		});
		expect(recipe.visual.animation?.payload.animationId).toBe(animationId);
		expect(recipe.visual.sourceAssets).toHaveLength(1);
		expect(recipe.visual.materialSources).toEqual([]);
		expect(recipe.visual.paletteSources).toEqual([]);
		expect(recipe.visual.textureRefs).toEqual([]);
		expect(recipe.visual.missingRefs).toEqual([]);
		expect(assetReader.requestedIds()).toEqual([
			"setup-model/020003e5",
			"animation/03000042",
			"setup-model/020003e5",
			"setup-appearance/020003e5",
		]);
	});

	it("resolves outdoor static-authored setup/default-animation sources through the same resolver contract", async () => {
		const setupModelId = 0x02000400;
		const animationId = 0x03000043;
		const assetReader = new FixturePreparedAssetReader([
			createSetupModelAsset({
				animationId,
				setupModelId,
			}),
			createAnimationAsset(animationId),
		]);

		const recipe = await resolveDynamicVisualRecipe({
			animationSelection: { kind: "setup-default" },
			assetReader,
			baseTransform: createTransform(),
			entityId: "static:outdoor:1",
			materialPolicy: createMaterialPolicy("static:outdoor:1"),
			modelData: null,
			setupModelId,
			source: createStaticAuthoredSource({
				landblockId: 0xda55ffff,
				ownerDomain: "outdoor-explicit-objects",
				placementId: "outdoor-placement:1",
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			}),
		});

		expect(recipe.source.kind).toBe("static-authored");
		expect(recipe.source.placementId).toBe("outdoor-placement:1");
		expect(recipe.source.sourceResidence.kind).toBe("outdoor-landblock");
		expect(recipe.visual.animation?.payload.animationId).toBe(animationId);
		expect(recipe.visual.setupModel.identity.sourceDid).toBe(setupModelId);
		expect(recipe.visual.sourceAssets).toHaveLength(1);
	});

	it("resolves env-cell static-authored setup/default-animation sources through the same resolver contract", async () => {
		const setupModelId = 0x02000401;
		const animationId = 0x03000044;
		const assetReader = new FixturePreparedAssetReader([
			createSetupModelAsset({
				animationId,
				setupModelId,
			}),
			createAnimationAsset(animationId),
		]);

		const recipe = await resolveDynamicVisualRecipe({
			animationSelection: { kind: "setup-default" },
			assetReader,
			baseTransform: createTransform(),
			entityId: "static:env-cell:1",
			materialPolicy: createMaterialPolicy("static:env-cell:1"),
			modelData: null,
			setupModelId,
			source: createStaticAuthoredSource({
				landblockId: 0x0555ffff,
				ownerDomain: "env-cell-system",
				placementId: "env-cell-placement:1",
				sourceResidence: {
					envCellId: 0x05550123,
					kind: "env-cell",
					landblockId: 0x0555ffff,
				},
			}),
		});

		expect(recipe.source.kind).toBe("static-authored");
		expect(recipe.source.placementId).toBe("env-cell-placement:1");
		expect(recipe.source.sourceResidence.kind).toBe("env-cell");
		expect(recipe.visual.animation?.payload.animationId).toBe(animationId);
		expect(recipe.visual.setupModel.identity.sourceDid).toBe(setupModelId);
		expect(recipe.visual.sourceAssets).toHaveLength(1);
	});

	it("resolves appearance override source closure keys without changing the recipe shape", async () => {
		const setupModelId = 0x02000402;
		const animationId = 0x03000045;
		const setupAppearanceKey = createHostAssetKey(
			"setup-appearance",
			"02000402?palette=04000010",
		);
		const assetReader = new FixturePreparedAssetReader([
			createSetupModelAsset({
				animationId,
				setupModelId,
			}),
			createAnimationAsset(animationId),
			createSetupModelAsset({
				animationId,
				key: setupAppearanceKey,
				setupModelId,
			}),
		]);

		const recipe = await resolveDynamicVisualRecipe({
			animationSelection: { kind: "setup-default" },
			assetReader,
			baseTransform: createTransform(),
			entityId: "runtime:appearance",
			materialPolicy: createMaterialPolicy("runtime:appearance"),
			modelData: createAppearanceOverride(),
			setupModelId,
			source: {
				kind: "runtime-authored",
				runtimeEntityId: "runtime:appearance",
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			},
		});

		expect(recipe.visual.setupModel.identity).toEqual({
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: setupModelId,
		});
		expect(assetReader.requestedIds()).toEqual([
			"setup-model/02000402",
			"animation/03000045",
			"setup-model/02000402",
			"setup-appearance/02000402?palette=04000010",
		]);
	});
});

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly #assets: ReadonlyMap<string, PreparedAsset>;
	readonly #requests: HostAssetKey[] = [];

	constructor(assets: readonly PreparedAsset[]) {
		this.#assets = new Map(
			assets.map((asset) => [formatHostAssetId(asset.key), asset]),
		);
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.#requests.push(key);
		const asset = this.#assets.get(formatHostAssetId(key));
		if (!asset) {
			return Promise.reject(
				new Error(`Missing fixture asset ${formatHostAssetId(key)}.`),
			);
		}

		return Promise.resolve(asset);
	}

	requestedIds(): readonly string[] {
		return this.#requests.map(formatHostAssetId);
	}
}

function createStaticAuthoredSource(options: {
	readonly landblockId: number;
	readonly ownerDomain: OutdoorStaticObjectLayerDomain | "env-cell-system";
	readonly placementId: string;
	readonly sourceResidence: DynamicEntityRecipeSource["sourceResidence"];
}): Extract<DynamicEntityRecipeSource, { readonly kind: "static-authored" }> {
	const owner: StaticLayerPeerRecordOwner = {
		domain: options.ownerDomain,
		key: {
			kind: options.ownerDomain,
			landblockId: options.landblockId,
		},
		kind: "layer-owner",
		ownerId: `${options.ownerDomain}:${options.landblockId.toString(16)}`,
	};

	return {
		kind: "static-authored",
		owner,
		placementId: options.placementId,
		sourceResidence: options.sourceResidence,
	};
}

function createMaterialPolicy(entityId: string): DynamicVisualMaterialPolicy {
	return {
		detailRolePolicy: {
			kind: "runtime-authored-none",
		},
		materialPlanningDomain: "outdoor-explicit-objects",
		visualObject: {
			entityId,
			kind: "dynamic-visual-object",
			resourceId: createDynamicVisualResourceId(entityId),
		},
	};
}

function createTransform(): DynamicEntityTransformState {
	return {
		baseLocalPlacement: createPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
	};
}

function createAppearanceOverride(): DynamicEntityAppearanceOverride {
	return {
		animPartChanges: [],
		paletteId: 0x04000010,
		subPalettes: [],
		textureChanges: [],
	};
}

function createSetupModelAsset(options: {
	readonly animationId: number | null;
	readonly key?: HostAssetKey;
	readonly setupModelId: number;
}): PreparedAsset {
	const key =
		options.key ?? createHostAssetKey("setup-model", options.setupModelId);
	const payload: SetupModelPayloadDto = {
		collisionWitness: {
			cylSphereCount: 0,
			sphereCount: 0,
		},
		connectionPoints: [],
		defaultAnimation: options.animationId,
		defaultMotionTable: null,
		defaultScript: null,
		defaultScriptTable: null,
		defaultSoundTable: null,
		dependencies: {
			gfxObjAssetIds: [],
		},
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [],
		placementSets: [],
		provenance: createProvenance("setup-model"),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId: options.setupModelId,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};

	return createPreparedAsset(key, payload);
}

function createAnimationAsset(animationId: number): PreparedAsset {
	return createPreparedAsset(createHostAssetKey("animation", animationId), {
		animationAssetId: `animation/${animationId.toString(16).padStart(8, "0")}`,
		animationId,
		dependencies: {},
		flags: null,
		frameCount: 1,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 0,
		partFrames: [
			{
				frameIndex: 0,
				hooks: [],
				localPlacements: [],
			},
		],
		provenance: createProvenance("animation"),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	});
}

function createPreparedAsset(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-30T00:00:00.000Z",
		revision: 1,
		sourceAssetId: formatHostAssetId(key),
	};
}

function createPlacement() {
	return {
		orientation: {
			w: 1,
			x: 0,
			y: 0,
			z: 0,
		},
		origin: {
			x: 0,
			y: 0,
			z: 0,
		},
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba",
		sourceAssetKind,
	};
}
