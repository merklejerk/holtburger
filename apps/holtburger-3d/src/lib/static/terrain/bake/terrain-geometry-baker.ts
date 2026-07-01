import type {
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialDrawSlice,
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerPlan,
	TerrainMaterialLayerEntry,
	TerrainMeshQuadFacts,
	TerrainMeshTriangleFacts,
	TerrainMeshVertexFacts,
	TerrainStaticScopePayload,
	TerrainTextureUseFacts,
} from "../../contracts";
import { uniqueSortedStaticTextureUseOwners } from "../../contracts";
import {
	classifyTerrainMaterialFamily,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_DETAIL_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "./terrain-material-family-classifier";
import { buildTerrainMaterialLayerPlan } from "./terrain-material-layer-planner";
import {
	createStaticTexturePlacementIntent,
	isObjectVisualTexturePlacementSnapshot,
} from "../../../textures/placement";
import type {
	TextureBindingRequirement,
	TexturePlacementIntent,
	TexturePlacementSnapshot,
	TextureResourceDependencies,
	TextureResourceRoleDependency,
	TextureUsagePurpose,
} from "../../../textures/placement";
import { classifyTextureUsagePurpose } from "../../../textures/placement";
import { createMaterialTextureDataUseKey } from "../../bake/static-material-texture-policy";

const UINT16_MAX_INDEX = 65_535;
const EMPTY_TEXTURE_PLACEMENT_SNAPSHOT: TexturePlacementSnapshot = {
	placementsByItemId: new Map(),
};

export class TerrainGeometryStaticBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeTerrainGeometry(input);
	}
}

export function bakeTerrainGeometry(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "outdoor-terrain") {
		throw new Error(
			`Terrain geometry baker only supports outdoor terrain batches. Received ${input.domain}.`,
		);
	}

	const itemResults = input.items.map((item) =>
		bakeTerrainGeometryItem(input, item),
	);
	const drawUnits = itemResults.flatMap((result) => result.drawUnits);

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		staticObjectBakeDiagnostics: [],
		staticObjectRenderInstances: [],
		staticObjectVisualResources: [],
		materialCoverage: [],
		portalApertureResources: [],
		revision: input.revision,
		envCellStaticObjectPlacementRecords: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: createTerrainSourceMappingRecords(drawUnits),
		staticSpatialRecords: createTerrainSpatialRecords(drawUnits),
		staticVisibilityRecords: [],
		bakeBatchId: input.bakeBatchId,
		tasks: input.items.map((item) => item.task),
		textureDependencies: createTerrainTextureDependencies(
			drawUnits,
			resolveTerrainTexturePlacementSnapshot(input.texturePlacementSnapshot),
		),
		textureUses: itemResults.flatMap((result) => result.textureUses),
	};
}

export function createTerrainTexturePlacementIntents(options: {
	readonly items: readonly StaticBakeBatchItem[];
}): readonly TexturePlacementIntent[] {
	return options.items.flatMap((item) => {
		if (
			item.task.domain !== "outdoor-terrain" ||
			item.payload.scope.kind !== "terrain"
		) {
			return [];
		}

		const requirementByBindingKey = createTerrainTextureRequirementIndex(
			item.task.ownerId,
			item.payload.scope.textureUses,
		);
		const plan = buildTerrainMaterialLayerPlan({
			createTextureUseId: (textureUse) =>
				createTerrainTextureBindingRequirement(item.task.ownerId, textureUse)
					.bindingKey,
			payload: item.payload.scope,
		});
		if (!plan) {
			return [];
		}

		return collectTerrainMaterialPlanTextureUseIds(plan).flatMap(
			(bindingKey) => {
				const requirement = requirementByBindingKey.get(bindingKey);
				if (!requirement) {
					return [];
				}
				return [
					createStaticTexturePlacementIntent(
						createTerrainStaticBakeTextureUse({
							owners: [],
							requirement,
						}),
						{
							affinityKey: createTerrainTextureAffinityKey(item.task.ownerId),
						},
					),
				];
			},
		);
	});
}

function resolveTerrainTexturePlacementSnapshot(
	snapshot: StaticBakeBatchInput["texturePlacementSnapshot"],
): TexturePlacementSnapshot {
	if (!snapshot) {
		return EMPTY_TEXTURE_PLACEMENT_SNAPSHOT;
	}
	if (isObjectVisualTexturePlacementSnapshot(snapshot)) {
		throw new Error(
			"Terrain bake received object-visual texture placement snapshot.",
		);
	}
	return snapshot;
}

function createTerrainSourceMappingRecords(
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticSourceMappingRecord[] {
	return drawUnits.flatMap((drawUnit) =>
		drawUnit.sourceTriangleIds.map((sourceTriangleId) => ({
			drawUnitId: drawUnit.drawUnitId,
			kind: "terrain-source-triangle" as const,
			owner: {
				drawUnitId: drawUnit.drawUnitId,
				kind: "draw-unit" as const,
			},
			sourceTriangleId,
		})),
	);
}

function createTerrainSpatialRecords(
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticSpatialRecord[] {
	return drawUnits.map((drawUnit) => ({
		drawUnitId: drawUnit.drawUnitId,
		kind: "draw-unit-bounds",
		owner: {
			drawUnitId: drawUnit.drawUnitId,
			kind: "draw-unit",
		},
		triangleCount: drawUnit.triangleCount,
	}));
}

function bakeTerrainGeometryItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly TerrainGeometryStaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (
		item.task.domain !== "outdoor-terrain" ||
		item.payload.scope.kind !== "terrain"
	) {
		throw new Error(
			`Terrain geometry baker only supports outdoor terrain payloads. Received ${item.task.domain}/${item.payload.scope.kind}.`,
		);
	}

	const textureUseScopeId = item.task.ownerId;
	const drawUnits = createTerrainGeometryDrawUnits(
		textureUseScopeId,
		item.payload.scope,
		resolveTerrainTexturePlacementSnapshot(input.texturePlacementSnapshot),
	);

	return {
		drawUnits,
		textureUses: createTerrainBakeTextureUses(input, item, drawUnits),
	};
}

function createTerrainGeometryDrawUnits(
	textureUseScopeId: string,
	payload: TerrainStaticScopePayload,
	texturePlacementSnapshot: TexturePlacementSnapshot,
): readonly TerrainGeometryStaticDrawUnit[] {
	const terrainMaterialPlan = buildTerrainMaterialLayerPlan({
		createTextureUseId: (textureUse) =>
			createTerrainTextureBindingRequirement(textureUseScopeId, textureUse)
				.bindingKey,
		payload,
	});
	const slices = createTerrainGeometrySlices(
		payload,
		terrainMaterialPlan,
		texturePlacementSnapshot,
	);
	const pcodeByQuadIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad.pcode] as const),
	);
	const quadByIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad] as const),
	);

	return slices.map((slice) =>
		createTerrainGeometryDrawUnit({
			drawUnitId:
				slices.length === 1
					? `${textureUseScopeId}:terrain-geometry`
					: `${textureUseScopeId}:terrain-geometry:${slice.slice.sliceId.replaceAll("/", "-")}`,
			landblockId: payload.landblock.landblockId,
			pcodeByQuadIndex,
			quadByIndex,
			terrainMaterialPlan: slice.plan,
			triangles: slice.triangles,
			vertices: payload.mesh.vertices,
		}),
	);
}

function createTerrainGeometryDrawUnit({
	drawUnitId,
	landblockId,
	pcodeByQuadIndex,
	quadByIndex,
	terrainMaterialPlan,
	triangles,
	vertices,
}: {
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly pcodeByQuadIndex: ReadonlyMap<number, number>;
	readonly quadByIndex: ReadonlyMap<number, TerrainMeshQuadFacts>;
	readonly terrainMaterialPlan: TerrainMaterialLayerPlan | null;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
	readonly vertices: readonly TerrainMeshVertexFacts[];
}): TerrainGeometryStaticDrawUnit {
	const positions = new Float32Array(triangles.length * 9);
	const texCoords = new Float32Array(triangles.length * 6);
	const layerSlots = new Float32Array(triangles.length * 3);
	const sourceTriangleIds: string[] = [];
	const material = classifyTerrainMaterialFamily({
		domain: "outdoor-terrain",
		plan: terrainMaterialPlan,
	});
	const layerSlotByPcode = new Map(
		terrainMaterialPlan?.layerEntries.map(
			(entry) => [entry.pcode, entry.slot] as const,
		) ?? [],
	);

	for (const [triangleIndex, triangle] of triangles.entries()) {
		writeTrianglePositions(
			layerSlots,
			positions,
			texCoords,
			layerSlotByPcode.get(pcodeByQuadIndex.get(triangle.quadIndex) ?? 0) ?? 0,
			triangleIndex,
			triangle,
			quadByIndex,
			vertices,
		);
		sourceTriangleIds.push(triangle.terrainTriangleId);
	}

	const vertexCount = triangles.length * 3;

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: vertexCount - 1 <= UINT16_MAX_INDEX ? "uint16" : "uint32",
		indices: createSequentialIndices(vertexCount),
		kind: "terrain-geometry",
		landblockId,
		layerSlots,
		materialBucketKey: material.materialBucketKey,
		materialFamily: material.materialFamily,
		primaryTextureUseId: material.primaryTextureUseId,
		positions,
		sourceTriangleIds,
		terrainFallbackReasons: material.terrainFallbackReasons,
		terrainMaterialPlan,
		texCoords,
		textureUseIds: material.textureUseIds,
		triangleCount: triangles.length,
		vertexCount,
	};
}

interface TerrainGeometrySlice {
	readonly plan: TerrainMaterialLayerPlan | null;
	readonly slice: TerrainMaterialDrawSlice;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
}

function createTerrainGeometrySlices(
	payload: TerrainStaticScopePayload,
	plan: TerrainMaterialLayerPlan | null,
	texturePlacementSnapshot: TexturePlacementSnapshot,
): readonly TerrainGeometrySlice[] {
	if (!plan || plan.layerEntries.length === 0 || plan.drawSlices.length === 0) {
		return [
			{
				plan,
				slice: {
					layerSlots: [],
					pcodes: [],
					reason:
						"terrain material unavailable; debug fallback uses full geometry",
					sliceId: "slice/0",
				},
				triangles: payload.mesh.triangles,
			},
		];
	}

	const quadPcodeByIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad.pcode] as const),
	);

	return plan.drawSlices.flatMap((slice) => {
		const slicePcodes = new Set(slice.pcodes);
		const triangles = payload.mesh.triangles.filter((triangle) => {
			const pcode = quadPcodeByIndex.get(triangle.quadIndex);
			return pcode === undefined ? false : slicePcodes.has(pcode);
		});
		return splitTerrainMaterialSliceByPlacementPages({
			plan: createTerrainMaterialSlicePlan(plan, slice),
			quadPcodeByIndex,
			slice,
			texturePlacementSnapshot,
			triangles,
		});
	});
}

function splitTerrainMaterialSliceByPlacementPages(options: {
	readonly plan: TerrainMaterialLayerPlan;
	readonly quadPcodeByIndex: ReadonlyMap<number, number>;
	readonly slice: TerrainMaterialDrawSlice;
	readonly texturePlacementSnapshot: TexturePlacementSnapshot;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
}): readonly TerrainGeometrySlice[] {
	const pageContext = createTerrainPagePartitionContext({
		detailRoles: options.plan.detailRoles,
		texturePlacementSnapshot: options.texturePlacementSnapshot,
	});
	if (!pageContext.valid) {
		return [
			createTerrainFallbackGeometrySlice({
				message: pageContext.message,
				plan: options.plan,
				slice: options.slice,
				triangles: options.triangles,
			}),
		];
	}

	const slices: TerrainGeometrySlice[] = [];
	let pendingEntries: TerrainMaterialLayerEntry[] = [];
	for (const entry of options.plan.layerEntries) {
		const entryContext = createTerrainPagePartitionContext({
			detailRoles: options.plan.detailRoles,
			entries: [entry],
			texturePlacementSnapshot: options.texturePlacementSnapshot,
		});
		if (!entryContext.valid) {
			if (pendingEntries.length > 0) {
				slices.push(
					createTerrainGeometrySliceForEntries({
						entries: pendingEntries,
						plan: options.plan,
						reason: "terrain page capacity slice",
						slice: options.slice,
						sliceIndex: slices.length,
						triangles: filterTerrainTrianglesForPcodes(
							options.triangles,
							options.quadPcodeByIndex,
							pendingEntries.map((pendingEntry) => pendingEntry.pcode),
						),
					}),
				);
				pendingEntries = [];
			}
			slices.push(
				createTerrainFallbackGeometrySlice({
					message: entryContext.message,
					plan: createTerrainMaterialPlanForEntries({
						entries: [entry],
						plan: options.plan,
						reason: "terrain page capacity fallback",
						sliceId: `${options.slice.sliceId}/page-${slices.length}`,
					}),
					slice: {
						layerSlots: [0],
						pcodes: [entry.pcode],
						reason: "terrain page capacity fallback",
						sliceId: `${options.slice.sliceId}/page-${slices.length}`,
					},
					triangles: filterTerrainTrianglesForPcodes(
						options.triangles,
						options.quadPcodeByIndex,
						[entry.pcode],
					),
				}),
			);
			continue;
		}

		const nextEntries = [...pendingEntries, entry];
		const nextContext = createTerrainPagePartitionContext({
			detailRoles: options.plan.detailRoles,
			entries: nextEntries,
			texturePlacementSnapshot: options.texturePlacementSnapshot,
		});
		if (pendingEntries.length > 0 && !nextContext.valid) {
			slices.push(
				createTerrainGeometrySliceForEntries({
					entries: pendingEntries,
					plan: options.plan,
					reason: "terrain page capacity slice",
					slice: options.slice,
					sliceIndex: slices.length,
					triangles: filterTerrainTrianglesForPcodes(
						options.triangles,
						options.quadPcodeByIndex,
						pendingEntries.map((pendingEntry) => pendingEntry.pcode),
					),
				}),
			);
			pendingEntries = [entry];
			continue;
		}

		pendingEntries = nextEntries;
	}

	if (pendingEntries.length > 0) {
		slices.push(
			createTerrainGeometrySliceForEntries({
				entries: pendingEntries,
				plan: options.plan,
				reason:
					slices.length === 0
						? `${options.slice.reason}; terrain pages fit shader limits`
						: "terrain page capacity slice",
				slice: options.slice,
				sliceIndex: slices.length,
				triangles: filterTerrainTrianglesForPcodes(
					options.triangles,
					options.quadPcodeByIndex,
					pendingEntries.map((pendingEntry) => pendingEntry.pcode),
				),
			}),
		);
	}

	return slices;
}

interface TerrainPagePartitionContext {
	readonly colorPages: ReadonlySet<string>;
	readonly detailPages: ReadonlySet<string>;
	readonly maskPages: ReadonlySet<string>;
	readonly message: string;
	readonly valid: boolean;
}

function createTerrainPagePartitionContext(options: {
	readonly detailRoles: TerrainMaterialLayerPlan["detailRoles"];
	readonly entries?: readonly TerrainMaterialLayerEntry[];
	readonly texturePlacementSnapshot: TexturePlacementSnapshot;
}): TerrainPagePartitionContext {
	const colorPages = new Set<string>();
	const detailPages = new Set<string>();
	const maskPages = new Set<string>();
	const addTextureUse = (textureUseId: string | null): string | null => {
		if (!textureUseId) {
			return null;
		}
		const placement =
			options.texturePlacementSnapshot.placementsByItemId.get(textureUseId);
		if (!placement) {
			throw new Error(
				`Terrain texture ${textureUseId} is missing a pre-bake placement.`,
			);
		}
		switch (placement.purpose) {
			case "terrain-color":
				colorPages.add(placement.pageId);
				return null;
			case "terrain-detail":
				detailPages.add(placement.pageId);
				return null;
			case "terrain-mask":
				maskPages.add(placement.pageId);
				return null;
			case "object-base-color":
			case "object-detail":
			case "object-index":
			case "object-palette":
				throw new Error(
					`Terrain texture ${textureUseId} was placed with incompatible purpose ${placement.purpose}.`,
				);
		}
	};

	for (const detailRole of options.detailRoles) {
		const error = addTextureUse(detailRole.texture.textureUseId);
		if (error) {
			return createInvalidTerrainPagePartitionContext(
				colorPages,
				detailPages,
				maskPages,
				error,
			);
		}
	}
	for (const entry of options.entries ?? []) {
		for (const binding of collectTerrainLayerEntryTextureBindings(entry)) {
			const error = addTextureUse(binding.textureUseId);
			if (error) {
				return createInvalidTerrainPagePartitionContext(
					colorPages,
					detailPages,
					maskPages,
					error,
				);
			}
		}
	}

	const overflowMessage = createTerrainPageOverflowMessage({
		colorPages,
		detailPages,
		maskPages,
	});
	if (overflowMessage) {
		return createInvalidTerrainPagePartitionContext(
			colorPages,
			detailPages,
			maskPages,
			overflowMessage,
		);
	}

	return {
		colorPages,
		detailPages,
		maskPages,
		message: "",
		valid: true,
	};
}

function createInvalidTerrainPagePartitionContext(
	colorPages: ReadonlySet<string>,
	detailPages: ReadonlySet<string>,
	maskPages: ReadonlySet<string>,
	message: string,
): TerrainPagePartitionContext {
	return {
		colorPages,
		detailPages,
		maskPages,
		message,
		valid: false,
	};
}

function createTerrainPageOverflowMessage(options: {
	readonly colorPages: ReadonlySet<string>;
	readonly detailPages: ReadonlySet<string>;
	readonly maskPages: ReadonlySet<string>;
}): string | null {
	if (options.colorPages.size > MAX_TERRAIN_COLOR_PAGES_PER_DRAW) {
		return `Terrain material draw slice requires ${options.colorPages.size} color pages; shader limit is ${MAX_TERRAIN_COLOR_PAGES_PER_DRAW}.`;
	}
	if (options.maskPages.size > MAX_TERRAIN_MASK_PAGES_PER_DRAW) {
		return `Terrain material draw slice requires ${options.maskPages.size} mask pages; shader limit is ${MAX_TERRAIN_MASK_PAGES_PER_DRAW}.`;
	}
	if (options.detailPages.size > MAX_TERRAIN_DETAIL_PAGES_PER_DRAW) {
		return `Terrain material draw slice requires ${options.detailPages.size} detail pages; shader limit is ${MAX_TERRAIN_DETAIL_PAGES_PER_DRAW}.`;
	}
	return null;
}

function createTerrainGeometrySliceForEntries(options: {
	readonly entries: readonly TerrainMaterialLayerEntry[];
	readonly plan: TerrainMaterialLayerPlan;
	readonly reason: string;
	readonly slice: TerrainMaterialDrawSlice;
	readonly sliceIndex: number;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
}): TerrainGeometrySlice {
	const sliceId = `${options.slice.sliceId}/page-${options.sliceIndex}`;
	return {
		plan: createTerrainMaterialPlanForEntries({
			entries: options.entries,
			plan: options.plan,
			reason: options.reason,
			sliceId,
		}),
		slice: {
			layerSlots: options.entries.map((entry, index) => index),
			pcodes: options.entries.map((entry) => entry.pcode),
			reason: options.reason,
			sliceId,
		},
		triangles: options.triangles,
	};
}

function createTerrainMaterialPlanForEntries(options: {
	readonly entries: readonly TerrainMaterialLayerEntry[];
	readonly plan: TerrainMaterialLayerPlan;
	readonly reason: string;
	readonly sliceId: string;
}): TerrainMaterialLayerPlan {
	const pcodeSet = new Set(options.entries.map((entry) => entry.pcode));
	const layerEntries = options.entries.map((entry, slot) => ({
		...entry,
		slot,
	}));
	const fallbackReasons = options.plan.fallbackReasons.filter((reason) =>
		isFallbackReasonRelevantToSlice(reason, pcodeSet),
	);
	return {
		detailRoles: options.plan.detailRoles,
		drawSlices: [
			{
				layerSlots: layerEntries.map((entry) => entry.slot),
				pcodes: layerEntries.map((entry) => entry.pcode),
				reason: options.reason,
				sliceId: options.sliceId,
			},
		],
		fallbackReasons,
		layerEntries,
		signature: `${options.plan.signature}|page-slice:${options.sliceId}`,
	};
}

function createTerrainFallbackGeometrySlice(options: {
	readonly message: string;
	readonly plan: TerrainMaterialLayerPlan;
	readonly slice: TerrainMaterialDrawSlice;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
}): TerrainGeometrySlice {
	return {
		plan: {
			...options.plan,
			fallbackReasons: [
				...options.plan.fallbackReasons,
				{
					code: "unsupported-material-binding",
					message: options.message,
					pcode: null,
					texture: null,
				},
			],
		},
		slice: options.slice,
		triangles: options.triangles,
	};
}

function filterTerrainTrianglesForPcodes(
	triangles: readonly TerrainMeshTriangleFacts[],
	quadPcodeByIndex: ReadonlyMap<number, number>,
	pcodes: readonly number[],
): readonly TerrainMeshTriangleFacts[] {
	const pcodeSet = new Set(pcodes);
	return triangles.filter((triangle) => {
		const pcode = quadPcodeByIndex.get(triangle.quadIndex);
		return pcode === undefined ? false : pcodeSet.has(pcode);
	});
}

function collectTerrainLayerEntryTextureBindings(
	entry: TerrainMaterialLayerEntry,
): readonly TerrainMaterialLayerEntry["base"][] {
	return [
		entry.base,
		...entry.overlays.flatMap((overlay) => [overlay.terrain, overlay.alpha]),
		...entry.roads.flatMap((road) => [road.road, road.alpha]),
	];
}

function createTerrainMaterialSlicePlan(
	plan: TerrainMaterialLayerPlan,
	slice: TerrainMaterialDrawSlice,
): TerrainMaterialLayerPlan {
	const sliceSlots = new Set(slice.layerSlots);
	const slotRemap = new Map(
		slice.layerSlots.map((slot, localSlot) => [slot, localSlot] as const),
	);
	const layerEntries = plan.layerEntries
		.filter((entry) => sliceSlots.has(entry.slot))
		.map((entry) => ({
			...entry,
			slot: slotRemap.get(entry.slot) ?? entry.slot,
		}));
	const slicePcodes = new Set(layerEntries.map((entry) => entry.pcode));
	const fallbackReasons = plan.fallbackReasons.filter((reason) =>
		isFallbackReasonRelevantToSlice(reason, slicePcodes),
	);

	return {
		detailRoles: plan.detailRoles,
		drawSlices: [
			{
				...slice,
				layerSlots: layerEntries.map((entry) => entry.slot),
				pcodes: layerEntries.map((entry) => entry.pcode),
				reason: `${slice.reason}; geometry partitioned before renderer material binding`,
			},
		],
		fallbackReasons,
		layerEntries,
		signature: `${plan.signature}|geometry-slice:${slice.sliceId}`,
	};
}

function isFallbackReasonRelevantToSlice(
	reason: TerrainMaterialFallbackReason,
	pcodes: ReadonlySet<number>,
): boolean {
	if (reason.code === "layer-overflow") {
		return false;
	}
	if (reason.pcode === null) {
		return true;
	}

	return pcodes.has(reason.pcode);
}

function writeTrianglePositions(
	layerSlots: Float32Array,
	positions: Float32Array,
	texCoords: Float32Array,
	layerSlot: number,
	triangleIndex: number,
	triangle: TerrainMeshTriangleFacts,
	quadByIndex: ReadonlyMap<number, TerrainMeshQuadFacts>,
	vertices: readonly TerrainMeshVertexFacts[],
): void {
	const quad = quadByIndex.get(triangle.quadIndex);
	if (!quad) {
		throw new Error(
			`Terrain triangle ${triangle.terrainTriangleId} references missing quad ${triangle.quadIndex}.`,
		);
	}

	for (let corner = 0; corner < triangle.vertexIndices.length; corner += 1) {
		const sourceVertexIndex = triangle.vertexIndices[corner];
		const vertex = vertices[sourceVertexIndex];
		if (!vertex) {
			throw new Error(
				`Terrain triangle ${triangle.terrainTriangleId} references missing vertex ${sourceVertexIndex}.`,
			);
		}

		const targetOffset = triangleIndex * 9 + corner * 3;
		positions[targetOffset] = vertex.x;
		positions[targetOffset + 1] = vertex.y;
		positions[targetOffset + 2] = vertex.z;

		const texCoordOffset = triangleIndex * 6 + corner * 2;
		const uv = terrainQuadUv(quad, sourceVertexIndex);
		texCoords[texCoordOffset] = uv[0];
		texCoords[texCoordOffset + 1] = uv[1];

		layerSlots[triangleIndex * 3 + corner] = layerSlot;
	}
}

function terrainQuadUv(
	quad: TerrainMeshQuadFacts,
	vertexIndex: number,
): readonly [number, number] {
	const cornerIndex = quad.vertexIndices.indexOf(vertexIndex);
	switch (cornerIndex) {
		case 0:
			return [0, 0];
		case 1:
			return [1, 0];
		case 2:
			return [1, 1];
		case 3:
			return [0, 1];
		default:
			throw new Error(
				`Terrain quad ${quad.terrainQuadId} does not contain vertex ${vertexIndex}.`,
			);
	}
}

function createTerrainBakeTextureUses(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticBakeTextureUse[] {
	if (item.payload.scope.kind !== "terrain") {
		return [];
	}

	const textureUsesById = new Map<string, StaticBakeTextureUse>();
	for (const drawUnit of drawUnits) {
		const boundTextureUseIds = new Set(drawUnit.textureUseIds);
		for (const textureUse of item.payload.scope.textureUses) {
			if (!textureUse.preparedTextureUse) {
				continue;
			}
			const requirement = createTerrainTextureBindingRequirement(
				item.task.ownerId,
				textureUse,
			);
			if (!boundTextureUseIds.has(requirement.bindingKey)) {
				continue;
			}

			const existing = textureUsesById.get(requirement.bindingKey);
			if (existing) {
				textureUsesById.set(requirement.bindingKey, {
					...existing,
					owners: uniqueSortedStaticTextureUseOwners([
						...existing.owners,
						{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" },
					]),
				});
				continue;
			}

			textureUsesById.set(
				requirement.bindingKey,
				createTerrainStaticBakeTextureUse({
					owners: [{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" }],
					requirement,
				}),
			);
		}
	}

	return [...textureUsesById.values()];
}

function createTerrainTextureUseId(
	textureUseScopeId: string,
	textureUse: TerrainTextureUseFacts,
): string {
	if (!textureUse.preparedTextureUse) {
		throw new Error("Prepared texture use disappeared during terrain bake.");
	}

	return [
		textureUseScopeId,
		"prepared-texture",
		textureUse.role,
		textureUse.preparedTextureUse.usage,
		textureUse.preparedTextureUse.renderSurface.renderSurfaceId
			.toString(16)
			.padStart(8, "0"),
	].join(":");
}

function createTerrainTextureBindingRequirement(
	textureUseScopeId: string,
	textureUse: TerrainTextureUseFacts,
): TextureBindingRequirement {
	const bindingKey = createTerrainTextureUseId(textureUseScopeId, textureUse);
	if (!textureUse.preparedTextureUse) {
		throw new Error("Prepared texture use disappeared during terrain bake.");
	}

	return {
		bindingKey,
		// Phase 12 keeps terrain renderer binding keys equal to placement item ids.
		placementItemId: bindingKey,
		textureUseId: bindingKey,
		purpose: classifyTextureUsagePurpose(
			textureUse.preparedTextureUse,
			"terrain",
		),
		samplingPolicy: undefined,
		source: {
			dataUse: textureUse.preparedTextureUse,
			kind: "material-texture-data-use",
		},
		sourceKey: createMaterialTextureDataUseKey(textureUse.preparedTextureUse),
	};
}

function createTerrainStaticBakeTextureUse(options: {
	readonly owners: StaticBakeTextureUse["owners"];
	readonly requirement: TextureBindingRequirement;
}): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		domain: "outdoor-terrain",
		owners: options.owners,
		source: options.requirement.source.dataUse,
		textureUseId: options.requirement.bindingKey,
	};
	if (!options.requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: options.requirement.samplingPolicy,
	};
}

function createTerrainTextureDependencies(
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
	texturePlacementSnapshot: TexturePlacementSnapshot,
): readonly TextureResourceDependencies[] {
	return drawUnits.flatMap((drawUnit) => {
		const roles = createTerrainTextureRoleDependencies(
			drawUnit,
			texturePlacementSnapshot,
		);
		if (roles.length === 0) {
			return [];
		}
		return [{ resourceId: drawUnit.drawUnitId, roles }];
	});
}

function createTerrainTextureRoleDependencies(
	drawUnit: TerrainGeometryStaticDrawUnit,
	texturePlacementSnapshot: TexturePlacementSnapshot,
): readonly TextureResourceRoleDependency[] {
	const itemIdsByPurpose = new Map<TextureUsagePurpose, Set<string>>();
	for (const bindingKey of drawUnit.textureUseIds) {
		// Terrain binding keys intentionally remain placement item ids during
		// Phase 12; the placement snapshot is the authority for dependency purpose.
		const placement =
			texturePlacementSnapshot.placementsByItemId.get(bindingKey);
		if (!placement) {
			throw new Error(
				`Terrain draw unit ${drawUnit.drawUnitId} is missing pre-bake texture placement ${bindingKey}.`,
			);
		}
		let itemIds = itemIdsByPurpose.get(placement.purpose);
		if (!itemIds) {
			itemIds = new Set<string>();
			itemIdsByPurpose.set(placement.purpose, itemIds);
		}
		itemIds.add(bindingKey);
	}

	return Array.from(itemIdsByPurpose, ([purpose, itemIds]) => ({
		itemIds: Array.from(itemIds).sort(),
		purpose,
	})).sort((left, right) => left.purpose.localeCompare(right.purpose));
}

function collectTerrainMaterialPlanTextureUseIds(
	plan: TerrainMaterialLayerPlan,
): readonly string[] {
	const textureUseIds = new Set<string>();
	for (const entry of plan.layerEntries) {
		for (const binding of collectTerrainLayerEntryTextureBindings(entry)) {
			if (binding.textureUseId) {
				textureUseIds.add(binding.textureUseId);
			}
		}
	}
	for (const detailRole of plan.detailRoles) {
		if (detailRole.texture.textureUseId) {
			textureUseIds.add(detailRole.texture.textureUseId);
		}
	}
	return Array.from(textureUseIds).sort();
}

function createTerrainTextureRequirementIndex(
	textureUseScopeId: string,
	textureUses: readonly TerrainTextureUseFacts[],
): ReadonlyMap<string, TextureBindingRequirement> {
	return new Map(
		textureUses
			.flatMap((textureUse) =>
				textureUse.preparedTextureUse
					? [
							createTerrainTextureBindingRequirement(
								textureUseScopeId,
								textureUse,
							),
						]
					: [],
			)
			.map((requirement) => [requirement.bindingKey, requirement] as const),
	);
}

function createTerrainTextureAffinityKey(textureUseScopeId: string): string {
	return ["terrain", textureUseScopeId].join(":");
}

function createSequentialIndices(
	vertexCount: number,
): Uint16Array | Uint32Array {
	const IndexArray =
		vertexCount - 1 <= UINT16_MAX_INDEX ? Uint16Array : Uint32Array;
	const indices = new IndexArray(vertexCount);

	for (let index = 0; index < vertexCount; index += 1) {
		indices[index] = index;
	}

	return indices;
}
