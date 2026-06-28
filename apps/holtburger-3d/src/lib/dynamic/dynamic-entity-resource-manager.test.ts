import { describe, expect, it, vi } from "vitest";
import { HostBackedAssetService } from "../assets/asset-service";
import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import type {
	AnimationPayloadDto,
	GfxObjPayloadDto,
	MaterialRecipePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../host/contracts";
import type {
	RuntimeHost,
	RuntimeHostSnapshot,
} from "../host/runtime-contracts";
import type {
	StaticAuthoredDynamicSeedRecord,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import { DynamicEntityController } from "./dynamic-entity-controller";
import { DynamicEntityResourceManager } from "./dynamic-entity-resource-manager";

describe("dynamic entity resource manager", () => {
	it("marks outdoor and env-cell visual resources ready through one path", async () => {
		const assetService = createAssetService();
		const controller = createController(assetService);

		controller.ingestStaticSeeds([
			createOutdoorSeedRecord(),
			createEnvCellDynamicSeedRecord(),
		]);
		await flushPromises();

		const records = controller.createSnapshot().records;
		expect(records).toHaveLength(2);
		expect(
			records.map((record) => record.resources.setupAnimation.status),
		).toEqual(["ready", "ready"]);
		expect(records.map((record) => record.animation.status)).toEqual([
			"ready",
			"ready",
		]);
		expect(records.map((record) => record.resources.status)).toEqual([
			"ready",
			"ready",
		]);
		expect(records.map((record) => record.resources.visual.status)).toEqual([
			"ready",
			"ready",
		]);
		expect(records[0]?.resources.visual).toMatchObject({
			renderParts: [
				{
					indexType: "uint16",
					materialFamily: "texture-rgba",
					materialPass: "opaque",
					partIndex: 0,
					sourceAssetId: "gfx-obj/01000020",
					triangleCount: 1,
					vertexCount: 3,
				},
			],
			textureRequirements: [
				{
					textureUseId:
						"dynamic-texture:08000011:base-color:06000010?cs=linear&mips=none&out=rgba8&usage=color",
				},
			],
		});
		const renderPart =
			records[0]?.resources.visual.status === "ready"
				? records[0].resources.visual.renderParts[0]
				: null;
		expect(Array.from(renderPart?.positions ?? [])).toEqual([
			0, 0, 0, 1, 0, 0, 0, 1, 0,
		]);
		expect(renderPart?.textureUseIds).toEqual([
			"dynamic-texture:08000011:base-color:06000010?cs=linear&mips=none&out=rgba8&usage=color",
		]);
		expect(records.map((record) => record.renderability.reasons)).toEqual([
			[],
			[],
		]);
	});

	it("splits mixed-material source parts into compatible dynamic render slices", async () => {
		const assetService = createAssetService({ mixedMaterialPart: true });
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();

		const visual = controller.createSnapshot().records[0]?.resources.visual;
		expect(visual?.status).toBe("ready");
		if (visual?.status !== "ready") {
			throw new Error("expected dynamic visual resources to be ready");
		}

		expect(
			visual.renderParts.map((part) => ({
				materialFamily: part.materialFamily,
				partIndex: part.partIndex,
				sourceAssetId: part.sourceAssetId,
				triangleCount: part.triangleCount,
			})),
		).toEqual([
			{
				materialFamily: "texture-rgba",
				partIndex: 0,
				sourceAssetId: "gfx-obj/01000020",
				triangleCount: 1,
			},
			{
				materialFamily: "flat-color",
				partIndex: 0,
				sourceAssetId: "gfx-obj/01000020",
				triangleCount: 1,
			},
		]);
		expect(
			Array.from(visual.renderParts[1]?.materialSlotIndices ?? []),
		).toEqual([1, 1, 1]);
	});

	it("dedupes shared setup and animation host assets while holding per-entity leases", async () => {
		const host = new ResolvingRuntimeHost();
		const assetService = new HostBackedAssetService({ host });
		const controller = createController(assetService);

		controller.ingestStaticSeeds([
			createOutdoorSeedRecord({ instanceId: "windmill-0" }),
			createOutdoorSeedRecord({ instanceId: "windmill-1" }),
		]);
		await flushPromises();

		expect(host.lookupCountByKey).toEqual(
			new Map([
				["setup-model:020003e5", 1],
				["animation:0300061b", 1],
				["gfx-obj:01000020", 1],
				["material:08000011", 1],
				["palette:04000010", 1],
				[
					"prepared-texture:06000010?cs=linear&mips=none&out=rgba8&usage=color",
					1,
				],
				["render-surface:06000010", 1],
				["setup-appearance:020003e5", 1],
				["surface-texture:05000010", 1],
			]),
		);
		expect(
			assetService.createSnapshot().committed.map((entry) => entry.leaseCount),
		).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
	});

	it("treats missing setup appearance as nonfatal when setup parts are sufficient", async () => {
		const assetService = createAssetService({
			failKeys: new Set(["setup-appearance:020003e5"]),
		});
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();

		expect(controller.createSnapshot().records[0]).toMatchObject({
			resources: {
				status: "ready",
				visual: {
					status: "ready",
				},
			},
		});
	});

	it("records concrete visual resource failures when material textures are missing", async () => {
		const assetService = createAssetService({
			failKeys: new Set(["render-surface:06000010"]),
		});
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();

		expect(controller.createSnapshot().records[0]).toMatchObject({
			renderability: {
				reasons: ["resource-load-failed", "visual-resources-failed"],
				status: "non-renderable",
			},
			resources: {
				status: "failed",
				visual: {
					failures: [
						{
							resource: "render-surface",
							resourceKey: {
								id: 0x06000010,
								kind: "render-surface",
							},
						},
					],
					status: "failed",
					unsupportedReasons: [
						{
							code: "missing-render-surface",
						},
					],
				},
			},
		});
	});

	it("records explicit missing setup failures and keeps the entity non-renderable", async () => {
		const assetService = createAssetService({
			failKeys: new Set(["setup-model:020003e5"]),
		});
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();

		expect(controller.createSnapshot().records[0]).toMatchObject({
			renderability: {
				reasons: ["resource-load-failed"],
				status: "non-renderable",
			},
			resources: {
				setupAnimation: {
					failures: [
						{
							message: "missing setup-model:020003e5",
							resource: "setup-model",
							resourceKey: {
								id: 0x020003e5,
								kind: "setup-model",
							},
						},
					],
					status: "failed",
				},
				status: "failed",
			},
		});
	});

	it("releases dynamic leases when static source retention removes records", async () => {
		const assetService = createAssetService();
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();
		expect(assetService.createSnapshot().committed[0]?.leaseCount).toBe(1);

		controller.retainStaticScopes([]);

		expect(
			assetService.createSnapshot().committed.map((entry) => entry.leaseCount),
		).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("tracks explicit-animation runtime spawns without static source facts", async () => {
		const host = new ResolvingRuntimeHost();
		const assetService = new HostBackedAssetService({ host });
		const controller = createController(assetService);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const runtimeId = controller.createRuntimeSpawn({
				animationSelection: { animationId: 0x0300061b, kind: "explicit" },
				baseLocalPlacement: createPlacement(),
				setupModelId: 0x020003e5,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			});
			await flushPromises();

			expect(host.lookupCountByKey).toEqual(
				new Map([
					["animation:0300061b", 1],
					["setup-model:020003e5", 1],
				]),
			);
			expect(controller.queryDynamicEntitySummary(runtimeId)).toMatchObject({
				renderability: {
					reasons: ["visual-resources-pending"],
					status: "non-renderable",
				},
				resources: {
					setupAnimation: {
						animationKey: { id: 0x0300061b, kind: "animation" },
						setupModelKey: { id: 0x020003e5, kind: "setup-model" },
						status: "ready",
					},
					status: "setup-animation-ready",
					visual: {
						status: "pending",
					},
				},
				source: {
					kind: "runtime-spawn",
					runtimeEntityId: runtimeId,
				},
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("does not expose or request animation zero for runtime setup-default spawns", async () => {
		const host = new ResolvingRuntimeHost();
		const assetService = new HostBackedAssetService({ host });
		const controller = createController(assetService);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const runtimeId = controller.createRuntimeSpawn({
				baseLocalPlacement: createPlacement(),
				setupModelId: 0x020003e5,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			});
			await flushPromises();

			expect(host.lookupCountByKey).toEqual(new Map());
			const setupAnimation =
				controller.queryDynamicEntitySummary(runtimeId)?.resources
					.setupAnimation;
			expect(setupAnimation).toMatchObject({
				pendingReason: "setup-default-animation-unresolved",
				setupModelKey: { id: 0x020003e5, kind: "setup-model" },
				status: "pending",
			});
			expect(
				setupAnimation !== undefined && "animationKey" in setupAnimation,
			).toBe(false);
		} finally {
			warn.mockRestore();
		}
	});

	it("releases runtime setup and animation leases on explicit removal", async () => {
		const assetService = createAssetService();
		const controller = createController(assetService);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const runtimeId = controller.createRuntimeSpawn({
				animationSelection: { animationId: 0x0300061b, kind: "explicit" },
				baseLocalPlacement: createPlacement(),
				setupModelId: 0x020003e5,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			});
			await flushPromises();

			expect(
				assetService.createSnapshot().committed.map((entry) => entry.leaseCount),
			).toEqual([1, 1]);

			expect(controller.removeRuntimeSpawn(runtimeId)).toBe(true);

			expect(
				assetService.createSnapshot().committed.map((entry) => entry.leaseCount),
			).toEqual([0, 0]);
		} finally {
			warn.mockRestore();
		}
	});
});

function createController(
	assetService: HostBackedAssetService,
): DynamicEntityController {
	const resourceManager = new DynamicEntityResourceManager({ assetService });
	return new DynamicEntityController({ resourceManager });
}

function createAssetService(
	options: {
		readonly failKeys?: ReadonlySet<string>;
		readonly mixedMaterialPart?: boolean;
	} = {},
): HostBackedAssetService {
	return new HostBackedAssetService({
		host: new ResolvingRuntimeHost(options),
	});
}

interface ResolvingRuntimeHostOptions {
	readonly failKeys?: ReadonlySet<string>;
	readonly mixedMaterialPart?: boolean;
}

class ResolvingRuntimeHost implements RuntimeHost {
	readonly lookupCountByKey = new Map<string, number>();
	readonly #failKeys: ReadonlySet<string>;
	readonly #mixedMaterialPart: boolean;

	constructor(options: ResolvingRuntimeHostOptions = {}) {
		this.#failKeys = options.failKeys ?? new Set();
		this.#mixedMaterialPart = options.mixedMaterialPart ?? false;
	}

	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset> {
		const keyString = `${key.kind}:${key.id}`;
		this.lookupCountByKey.set(
			keyString,
			(this.lookupCountByKey.get(keyString) ?? 0) + 1,
		);
		if (this.#failKeys.has(keyString)) {
			return Promise.reject(new Error(`missing ${keyString}`));
		}
		return Promise.resolve({
			key,
			payload: createPayload(key, {
				mixedMaterialPart: this.#mixedMaterialPart,
			}),
			preparedAt: "2026-06-26T00:00:00.000Z",
			revision,
			sourceAssetId: `${key.kind}/${key.id}`,
		});
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

function createPayload(
	key: HostAssetKey,
	options: { readonly mixedMaterialPart: boolean },
): unknown {
	switch (key.kind) {
		case "animation":
			return createAnimationPayload();
		case "setup-model":
			return createSetupModelPayload();
		case "setup-appearance":
			return createSetupAppearancePayload(options);
		case "gfx-obj":
			return createGfxObjPayload(options);
		case "material":
			return createMaterialPayload(key);
		case "surface-texture":
			return createSurfaceTexturePayload();
		case "render-surface":
			return createRenderSurfacePayload();
		case "palette":
			return {
				colorCount: 256,
				colorsArgb: new Uint32Array(256),
				kind: "palette",
				paletteId: Number.parseInt(key.id, 16),
			};
		case "prepared-texture":
			return { kind: "prepared-texture" };
		default:
			return { kind: key.kind };
	}
}

function createSetupModelPayload(): SetupModelPayloadDto {
	return {
		connectionPoints: [],
		defaultAnimation: 0x0300061b,
		defaultScript: null,
		defaultSoundTable: null,
		dependencies: { gfxObjAssetIds: ["gfx-obj/01000020"] },
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				parentIndex: null,
				partIndex: 0,
				scale: null,
			},
		],
		placementSets: [],
		provenance: createProvenance("setup-model"),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId: 0x020003e5,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};
}

function createAnimationPayload(): AnimationPayloadDto {
	return {
		animationAssetId: "animation/0300061b",
		animationId: 0x0300061b,
		dependencies: {},
		flags: 0,
		frameCount: 1,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 1,
		partFrames: [
			{
				frameIndex: 0,
				hooks: [],
				localPlacements: [createPlacement()],
			},
		],
		provenance: createProvenance("animation"),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createSetupAppearancePayload(options: {
	readonly mixedMaterialPart: boolean;
}): SetupAppearancePayloadDto {
	return {
		animPartChanges: [],
		appearanceKey: "setup-appearance/020003e5",
		dependencies: {
			materialAssetIds: options.mixedMaterialPart
				? ["material/08000011", "material/08000012"]
				: ["material/08000011"],
			paletteAssetIds: [],
		},
		kind: "setup-appearance",
		paletteId: null,
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				materialSlots: [
					{
						materialAssetId: "material/08000011",
						slotIndex: 0,
						surfaceId: 0x08000010,
					},
					...(options.mixedMaterialPart
						? [
								{
									materialAssetId: "material/08000012",
									slotIndex: 1,
									surfaceId: 0x08000012,
								},
							]
						: []),
				],
				partIndex: 0,
			},
		],
		provenance: createProvenance("setup-appearance"),
		residencyKind: "unknown",
		setupModelId: 0x020003e5,
		sourceAssetKind: "setup-appearance",
		subPalettes: [],
		textureChanges: [],
	};
}

function createGfxObjPayload(options: {
	readonly mixedMaterialPart: boolean;
}): GfxObjPayloadDto {
	return {
		dependencies: {
			materialAssetIds: options.mixedMaterialPart
				? ["material/08000010", "material/08000012"]
				: ["material/08000010"],
		},
		didDegrade: null,
		drawingBsp: null,
		drawingPolygons: [],
		flags: null,
		gfxObjId: 0x01000020,
		kind: "gfx-obj",
		physicsWitness: { hasBsp: false, polygonCount: 1, rootKind: null },
		provenance: createProvenance("gfx-obj"),
		renderGeometry: {
			bounds: {
				max: { x: 1, y: 1, z: 1 },
				min: { x: 0, y: 0, z: 0 },
			},
			invalidPolygons: [],
			normals: [],
			positions: options.mixedMaterialPart
				? new Float32Array([
						0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 1, 2, 0,
					])
				: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			skippedPolygonCount: 0,
			sourceId: 0x01000020,
			surfaceIds: options.mixedMaterialPart
				? [0x08000010, 0x08000012]
				: [0x08000010],
			triangleCount: options.mixedMaterialPart ? 2 : 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: null,
					polygonId: 7,
					surfaceId: 0x08000010,
				},
				...(options.mixedMaterialPart
					? [
							{
								firstVertex: 3,
								materialVariantSignature: null,
								polygonId: 8,
								surfaceId: 0x08000012,
							},
						]
					: []),
			],
			uvs: options.mixedMaterialPart
				? new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
				: new Float32Array([0, 0, 1, 0, 0, 1]),
			vertexCount: options.mixedMaterialPart ? 6 : 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: options.mixedMaterialPart
			? [0x08000010, 0x08000012]
			: [0x08000010],
		vertexArray: { vertices: [] },
	};
}

function createMaterialPayload(key: HostAssetKey): MaterialRecipePayloadDto {
	const materialId = Number.parseInt(key.id, 16);
	if (materialId === 0x08000012) {
		return {
			dependencies: {
				paletteAssetIds: [],
				renderSurfaceAssetIds: [],
				surfaceTextureAssetIds: [],
			},
			diffuse: 1,
			kind: "material-recipe",
			luminosity: 0,
			provenance: createProvenance("material-recipe"),
			residencyKind: "unknown",
			source: {
				argb: 0xff604b2b,
				kind: "solid-color",
			},
			sourceAssetKind: "material-recipe",
			surfaceId: 0x08000012,
			surfaceType: 0,
			translucency: 0,
		};
	}
	return {
		dependencies: {
			paletteAssetIds: ["palette/04000010"],
			renderSurfaceAssetIds: ["render-surface/06000010"],
			surfaceTextureAssetIds: ["surface-texture/05000010"],
		},
		diffuse: 1,
		kind: "material-recipe",
		luminosity: 0,
		provenance: createProvenance("material-recipe"),
		residencyKind: "unknown",
		source: {
			kind: "texture",
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [0x04000010],
			selectedRenderSurfaceId: 0x06000010,
			surfaceTextureId: 0x05000010,
		},
		sourceAssetKind: "material-recipe",
		surfaceId: 0x08000011,
		surfaceType: 0,
		translucency: 0,
	};
}

function createSurfaceTexturePayload(): SurfaceTexturePayloadDto {
	return {
		dependencies: { renderSurfaceAssetIds: ["render-surface/06000010"] },
		kind: "surface-texture",
		provenance: createProvenance("surface-texture"),
		renderSurfaceIds: [0x06000010],
		residencyKind: "unknown",
		selectedRenderSurfaceId: 0x06000010,
		sourceAssetKind: "surface-texture",
		surfaceTextureId: 0x05000010,
		textureType: 0,
		unknown: 0,
	};
}

function createRenderSurfacePayload(): RenderSurfacePayloadDto {
	return {
		defaultPaletteId: 0x04000010,
		dependencies: { paletteAssetIds: ["palette/04000010"] },
		format: "A8R8G8B8",
		formatRaw: 0,
		height: 1,
		kind: "render-surface",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: 0x06000010,
		residencyKind: "unknown",
		sourceAssetKind: "render-surface",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 255, 255, 255]),
		unknown: 0,
		width: 1,
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind,
	};
}

function createOutdoorSeedRecord(
	options: { readonly instanceId?: string } = {},
): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "outdoor-static-object-dynamic-seed",
		owner: createOwner("outdoor-buildings"),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: options.instanceId ?? "windmill-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellDynamicSeedRecord(): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "env-cell-static-object-dynamic-seed",
		owner: createOwner("landblock-env-cells"),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			envCellId: 0xda550100,
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: "env-cell-static-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "env-cells",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createOwner(
	domain: StaticWorkPeerRecordOwner["domain"],
): StaticWorkPeerRecordOwner {
	return {
		domain,
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		workId: `1:landblock:da55ffff:${domain}`,
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
