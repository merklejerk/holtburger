import type {
	SurfaceTextureIdentity,
	TerrainMaterialDrawSlice,
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerEntry,
	TerrainMaterialLayerPlan,
	TerrainMaterialSourceFacts,
	TerrainMaterialTextureRoleBinding,
	TerrainMaterialTypeFacts,
	TerrainRoadAlphaMapFacts,
	TerrainStaticScopePayload,
	TerrainTextureUseFacts,
} from "../../contracts";

const DEFAULT_TERRAIN_LAYER_LIMIT = 8;
const ROAD_TYPE_TERRAIN_CODE = 3;
const TERRAIN_CODE_MASK = 0x1f;
const ROAD_CORNER_MASKS = [0x0c00_0000, 0x0300_0000, 0x00c0_0000, 0x0030_0000];

export interface TerrainMaterialLayerPlannerOptions {
	readonly payload: TerrainStaticScopePayload;
	readonly createTextureUseId: (textureUse: TerrainTextureUseFacts) => string;
	readonly maxLayerEntries?: number;
}

export function buildTerrainMaterialLayerPlan({
	payload,
	createTextureUseId,
	maxLayerEntries = DEFAULT_TERRAIN_LAYER_LIMIT,
}: TerrainMaterialLayerPlannerOptions): TerrainMaterialLayerPlan | null {
	const pcodes = uniqueSortedNumbers(
		payload.mesh.quads.map((quad) => quad.pcode),
	);
	if (pcodes.length === 0) {
		return null;
	}

	const context = createPlannerContext(payload, createTextureUseId);
	const layerEntries = pcodes
		.flatMap((pcode) => buildTerrainMaterialLayerEntry(context, pcode))
		.map((entry, slot) => ({ ...entry, slot }));
	const detailRoles = createDetailRoles(context);
	const drawSlices = createDrawSlices(
		layerEntries,
		maxLayerEntries,
		context.fallbackReasons,
	);

	return {
		detailRoles,
		drawSlices,
		fallbackReasons: context.fallbackReasons,
		layerEntries,
		signature: [
			`terrain-material:${payload.terrainMaterial.identity.regionNumber}`,
			`pcodes:${pcodes.join(",")}`,
			`layers:${layerEntries.map((entry) => `${entry.slot}:${entry.pcode}`).join(",")}`,
			`slices:${drawSlices.length}`,
			`fallbacks:${context.fallbackReasons.length}`,
		].join("|"),
	};
}

interface PlannerContext {
	readonly payload: TerrainStaticScopePayload;
	readonly terrainByCode: ReadonlyMap<number, TerrainMaterialTypeFacts>;
	readonly textureUseByRoleAndTexture: ReadonlyMap<
		string,
		TerrainTextureUseFacts
	>;
	readonly createTextureUseId: (textureUse: TerrainTextureUseFacts) => string;
	readonly fallbackReasons: TerrainMaterialFallbackReason[];
}

function createPlannerContext(
	payload: TerrainStaticScopePayload,
	createTextureUseId: (textureUse: TerrainTextureUseFacts) => string,
): PlannerContext {
	return {
		createTextureUseId,
		fallbackReasons: [],
		payload,
		terrainByCode: new Map(
			payload.terrainMaterial.terrainTypes.map((entry) => [
				entry.terrainCode,
				entry,
			]),
		),
		textureUseByRoleAndTexture: new Map(
			payload.textureUses.map((textureUse) => [
				createTextureUseKey(textureUse.role, textureUse.texture),
				textureUse,
			]),
		),
	};
}

function buildTerrainMaterialLayerEntry(
	context: PlannerContext,
	pcode: number,
): TerrainMaterialLayerEntry[] {
	const roadCodes = decodeRoadCodes(pcode);
	const roadTerrain = context.terrainByCode.get(ROAD_TYPE_TERRAIN_CODE) ?? null;
	if (roadCodes.allRoad && roadTerrain) {
		const base = createTextureBinding({
			context,
			pcode,
			role: "terrain-base",
			terrain: roadTerrain,
			wrap: "repeat",
		});
		return [
			{
				allRoad: true,
				base,
				colorRefCount: 1,
				maskRefCount: 0,
				overlays: [],
				pcode,
				roads: [],
				slot: 0,
			},
		];
	}
	if (roadCodes.allRoad && !roadTerrain) {
		pushFallbackReason(context, {
			code: "missing-terrain-type",
			message: `Missing terrain material type ${ROAD_TYPE_TERRAIN_CODE} for pcode ${pcode}.`,
			pcode,
			texture: null,
		});
	}

	const terrainLayers = selectTerrainLayers(decodeTerrainCodes(pcode));
	const baseTerrain = getTerrain(context, terrainLayers.baseCode, pcode);
	if (!baseTerrain) {
		return [];
	}

	const overlays = terrainLayers.overlayCodes.flatMap((overlayCode) => {
		const terrain = getTerrain(context, overlayCode.terrainCode, pcode);
		const alpha = selectTerrainAlpha({
			material: context.payload.terrainMaterial,
			pcode,
			tcode: overlayCode.tcode,
		});
		if (!terrain || !alpha) {
			if (!alpha) {
				pushFallbackReason(context, {
					code: "missing-terrain-alpha",
					message: `Could not resolve terrain alpha selector ${overlayCode.tcode} for pcode ${pcode}.`,
					pcode,
					texture: null,
				});
			}
			return [];
		}

		return [
			{
				alpha: createMaskBinding(
					context,
					pcode,
					"terrain-alpha",
					alpha.texture,
				),
				rotation: alpha.rotation,
				terrain: createTextureBinding({
					context,
					pcode,
					role: "terrain-base",
					terrain,
					wrap: "repeat",
				}),
			},
		];
	});
	const roads =
		roadTerrain && roadCodes.codes.length > 0
			? roadCodes.codes.flatMap((rcode) => {
					const road = selectRoadAlpha({
						material: context.payload.terrainMaterial,
						pcode,
						rcode,
					});
					if (!road) {
						pushFallbackReason(context, {
							code: "missing-road-alpha",
							message: `Could not resolve road alpha selector ${rcode} for pcode ${pcode}.`,
							pcode,
							texture: null,
						});
						return [];
					}
					return [
						{
							alpha: createMaskBinding(
								context,
								pcode,
								"road-alpha",
								road.entry.alphaTexture,
							),
							road: createSurfaceBinding({
								context,
								pcode,
								role: "road",
								texture: road.entry.roadTexture,
								tiling: normalizeTiling(roadTerrain.tiling),
								wrap: "repeat",
							}),
							rotation: road.rotation,
						},
					];
				})
			: [];
	if (roadCodes.codes.length > 0 && !roadTerrain) {
		pushFallbackReason(context, {
			code: "missing-terrain-type",
			message: `Missing terrain material type ${ROAD_TYPE_TERRAIN_CODE} for pcode ${pcode}.`,
			pcode,
			texture: null,
		});
	}

	return [
		{
			allRoad: false,
			base: createTextureBinding({
				context,
				pcode,
				role: "terrain-base",
				terrain: baseTerrain,
				wrap: "repeat",
			}),
			colorRefCount: 1 + overlays.length + (roads.length > 0 ? 1 : 0),
			maskRefCount: overlays.length + roads.length,
			overlays,
			pcode,
			roads,
			slot: 0,
		},
	];
}

function createDetailRoles(
	context: PlannerContext,
): TerrainMaterialLayerPlan["detailRoles"] {
	return context.payload.regionRenderProfile.detailRoles.flatMap((role) => {
		if (role.role !== "landscape") {
			return [];
		}
		if (role.tiling <= 0 || role.fadeFar <= role.fadeNear) {
			pushFallbackReason(context, {
				code: "invalid-detail-role",
				message: `Invalid landscape detail role for texture ${role.texture.surfaceTextureId}.`,
				pcode: null,
				texture: role.texture,
			});
			return [];
		}

		return [
			{
				fadeFar: role.fadeFar,
				fadeNear: role.fadeNear,
				role: role.role,
				texture: createSurfaceBinding({
					context,
					pcode: null,
					role: "detail",
					texture: role.texture,
					tiling: normalizeTiling(role.tiling),
					wrap: "repeat",
				}),
			},
		];
	});
}

function createDrawSlices(
	layerEntries: readonly TerrainMaterialLayerEntry[],
	maxLayerEntries: number,
	fallbackReasons: TerrainMaterialFallbackReason[],
): readonly TerrainMaterialDrawSlice[] {
	const requiresMultipleSlices = layerEntries.length > maxLayerEntries;
	if (!requiresMultipleSlices) {
		return [
			{
				layerSlots: layerEntries.map((entry) => entry.slot),
				pcodes: layerEntries.map((entry) => entry.pcode),
				reason: "terrain material fits shader layer limit",
				sliceId: "slice/0",
			},
		];
	}

	fallbackReasons.push({
		code: "layer-overflow",
		message: `Terrain material requires multiple draw slices for ${layerEntries.length} layer entries; shader layer limit is ${maxLayerEntries}.`,
		pcode: null,
		texture: null,
	});

	const slices: TerrainMaterialDrawSlice[] = [];
	let sliceEntries: TerrainMaterialLayerEntry[] = [];
	for (const entry of layerEntries) {
		const nextEntries = [...sliceEntries, entry];
		if (sliceEntries.length > 0 && nextEntries.length > maxLayerEntries) {
			pushDrawSlice(slices, sliceEntries);
			sliceEntries = [entry];
			continue;
		}

		sliceEntries = nextEntries;
	}

	if (sliceEntries.length > 0) {
		pushDrawSlice(slices, sliceEntries);
	}

	return slices;
}

function pushDrawSlice(
	slices: TerrainMaterialDrawSlice[],
	sliceEntries: readonly TerrainMaterialLayerEntry[],
): void {
	const sliceIndex = slices.length;
	slices.push({
		layerSlots: sliceEntries.map((entry) => entry.slot),
		pcodes: sliceEntries.map((entry) => entry.pcode),
		reason: `terrain material capacity slice ${sliceIndex + 1}`,
		sliceId: `slice/${sliceIndex}`,
	});
}

function createTextureBinding({
	context,
	pcode,
	role,
	terrain,
	wrap,
}: {
	readonly context: PlannerContext;
	readonly pcode: number;
	readonly role: TerrainTextureUseFacts["role"];
	readonly terrain: TerrainMaterialTypeFacts;
	readonly wrap: TerrainMaterialTextureRoleBinding["wrap"];
}): TerrainMaterialTextureRoleBinding {
	return createSurfaceBinding({
		context,
		pcode,
		role,
		texture: terrain.texture,
		tiling: normalizeTiling(terrain.tiling),
		wrap,
	});
}

function createMaskBinding(
	context: PlannerContext,
	pcode: number,
	role: TerrainTextureUseFacts["role"],
	texture: SurfaceTextureIdentity,
): TerrainMaterialTextureRoleBinding {
	return createSurfaceBinding({
		context,
		pcode,
		role,
		texture,
		tiling: 1,
		wrap: "clamp",
	});
}

function createSurfaceBinding({
	context,
	pcode,
	role,
	texture,
	tiling,
	wrap,
}: {
	readonly context: PlannerContext;
	readonly pcode: number | null;
	readonly role: TerrainTextureUseFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly tiling: number;
	readonly wrap: TerrainMaterialTextureRoleBinding["wrap"];
}): TerrainMaterialTextureRoleBinding {
	const textureUse = context.textureUseByRoleAndTexture.get(
		createTextureUseKey(role, texture),
	);
	if (!textureUse?.preparedTextureUse) {
		pushFallbackReason(context, {
			code: "missing-texture-use",
			message: `Missing prepared ${role} texture use for surface ${texture.surfaceTextureId}.`,
			pcode,
			texture,
		});
	}

	return {
		role,
		texture,
		textureUseId: textureUse?.preparedTextureUse
			? context.createTextureUseId(textureUse)
			: null,
		tiling,
		wrap,
	};
}

function getTerrain(
	context: PlannerContext,
	terrainCode: number,
	pcode: number,
): TerrainMaterialTypeFacts | null {
	const terrain = context.terrainByCode.get(terrainCode);
	if (!terrain) {
		pushFallbackReason(context, {
			code: "missing-terrain-type",
			message: `Missing terrain material type ${terrainCode} for pcode ${pcode}.`,
			pcode,
			texture: null,
		});
		return null;
	}

	return terrain;
}

function decodeTerrainCodes(pcode: number): [number, number, number, number] {
	return [
		(pcode >> 15) & TERRAIN_CODE_MASK,
		(pcode >> 10) & TERRAIN_CODE_MASK,
		(pcode >> 5) & TERRAIN_CODE_MASK,
		pcode & TERRAIN_CODE_MASK,
	];
}

interface TerrainLayerSelection {
	readonly baseCode: number;
	readonly overlayCodes: readonly TerrainOverlayCode[];
}

interface TerrainOverlayCode {
	readonly terrainCode: number;
	readonly tcode: number;
}

function selectTerrainLayers(
	terrainCodes: readonly number[],
): TerrainLayerSelection {
	for (let firstIndex = 0; firstIndex < terrainCodes.length; firstIndex += 1) {
		for (
			let secondIndex = firstIndex + 1;
			secondIndex < terrainCodes.length;
			secondIndex += 1
		) {
			if (terrainCodes[firstIndex] === terrainCodes[secondIndex]) {
				return selectRepeatedTerrainLayers(terrainCodes, firstIndex);
			}
		}
	}

	return {
		baseCode: terrainCodes[0] ?? 0,
		overlayCodes: terrainCodes.slice(1).map((terrainCode, index) => ({
			tcode: 1 << (index + 1),
			terrainCode,
		})),
	};
}

function selectRepeatedTerrainLayers(
	terrainCodes: readonly number[],
	baseIndex: number,
): TerrainLayerSelection {
	const baseCode = terrainCodes[baseIndex] ?? 0;
	let firstOverlayCode: number | null = null;
	let firstOverlayTcode = 0;
	const overlayCodes: TerrainOverlayCode[] = [];
	for (let index = 0; index < terrainCodes.length; index += 1) {
		const terrainCode = terrainCodes[index] ?? 0;
		if (terrainCode === baseCode) {
			continue;
		}
		if (firstOverlayTcode === 0) {
			firstOverlayCode = terrainCode;
			firstOverlayTcode = 1 << index;
			overlayCodes.push({ tcode: firstOverlayTcode, terrainCode });
			continue;
		}
		if (
			firstOverlayCode === terrainCode &&
			firstOverlayTcode === 1 << (index - 1)
		) {
			overlayCodes[0] = {
				tcode: firstOverlayTcode + (1 << index),
				terrainCode,
			};
		} else {
			overlayCodes.push({ tcode: 1 << index, terrainCode });
		}
		break;
	}

	return { baseCode, overlayCodes };
}

interface RoadCodeSelection {
	readonly allRoad: boolean;
	readonly codes: readonly number[];
}

function decodeRoadCodes(pcode: number): RoadCodeSelection {
	let mask = 0;
	for (let index = 0; index < ROAD_CORNER_MASKS.length; index += 1) {
		if ((pcode & (ROAD_CORNER_MASKS[index] ?? 0)) !== 0) {
			mask |= 1 << index;
		}
	}
	switch (mask) {
		case 0x0:
			return { allRoad: false, codes: [] };
		case 0xf:
			return { allRoad: true, codes: [] };
		case 0xe:
			return { allRoad: false, codes: [6, 12] };
		case 0xd:
			return { allRoad: false, codes: [9, 12] };
		case 0xb:
			return { allRoad: false, codes: [9, 3] };
		case 0x7:
			return { allRoad: false, codes: [3, 6] };
		default:
			return { allRoad: false, codes: [mask] };
	}
}

function selectTerrainAlpha({
	material,
	pcode,
	tcode,
}: {
	readonly material: TerrainMaterialSourceFacts;
	readonly pcode: number;
	readonly tcode: number;
}): {
	readonly texture: SurfaceTextureIdentity;
	readonly rotation: number;
} | null {
	const terrainMaps = material.terrainAlphaMaps.filter((map) =>
		isSideTerrainTcode(tcode) ? map.alphaIndex >= 4 : map.alphaIndex < 4,
	);
	if (terrainMaps.length === 0) {
		return null;
	}
	const startIndex = terrainPrngIndex(pcode, terrainMaps.length);
	for (let offset = 0; offset < terrainMaps.length; offset += 1) {
		const map = terrainMaps[(startIndex + offset) % terrainMaps.length];
		if (!map) {
			continue;
		}
		const rotation = findRotatedSelector(map.selector, tcode);
		if (rotation !== null) {
			return {
				rotation,
				texture: map.texture,
			};
		}
	}

	return null;
}

function selectRoadAlpha({
	material,
	pcode,
	rcode,
}: {
	readonly material: TerrainMaterialSourceFacts;
	readonly pcode: number;
	readonly rcode: number;
}): {
	readonly entry: TerrainRoadAlphaMapFacts;
	readonly rotation: number;
} | null {
	if (material.roadAlphaMaps.length === 0) {
		return null;
	}
	const startIndex = terrainPrngIndex(pcode, material.roadAlphaMaps.length);
	for (let offset = 0; offset < material.roadAlphaMaps.length; offset += 1) {
		const map =
			material.roadAlphaMaps[
				(startIndex + offset) % material.roadAlphaMaps.length
			];
		if (!map) {
			continue;
		}
		const rotation = findRotatedSelector(map.selector, rcode);
		if (rotation !== null) {
			return { entry: map, rotation };
		}
	}

	return null;
}

function terrainPrngIndex(pcode: number, count: number): number {
	const mixed = (Math.imul(1_379_576_222, pcode) - 1_372_186_442) >>> 0;
	const value = mixed * 2.3283064e-10 * count;
	const index = Math.floor(value);
	return index >= count ? 0 : Math.max(index, 0);
}

function findRotatedSelector(selector: number, target: number): number | null {
	let current = selector;
	for (let rotation = 0; rotation < 4; rotation += 1) {
		if (current === target) {
			return rotation;
		}
		current *= 2;
		if (current >= 16) {
			current -= 15;
		}
	}

	return null;
}

function isSideTerrainTcode(tcode: number): boolean {
	return tcode !== 1 && tcode !== 2 && tcode !== 4 && tcode !== 8;
}

function normalizeTiling(tiling: number): number {
	return Math.max(tiling, 1);
}

function createTextureUseKey(
	role: TerrainTextureUseFacts["role"],
	texture: SurfaceTextureIdentity,
): string {
	return `${role}:${texture.surfaceTextureId}`;
}

function pushFallbackReason(
	context: PlannerContext,
	reason: TerrainMaterialFallbackReason,
): void {
	if (
		context.fallbackReasons.some(
			(existingReason) =>
				existingReason.code === reason.code &&
				existingReason.pcode === reason.pcode &&
				existingReason.texture?.surfaceTextureId ===
					reason.texture?.surfaceTextureId &&
				existingReason.message === reason.message,
		)
	) {
		return;
	}

	context.fallbackReasons.push(reason);
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
