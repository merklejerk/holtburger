import type {
	PreparedRenderSurfacePayload,
	PreparedSurfaceTexturePayload,
	PreparedTerrainMaterialTablePayload,
	PreparedTerrainMaterialTypeEntry,
	PreparedTerrainRoadAlphaMapEntry,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export interface TerrainBlendPlanSet {
	plans: TerrainBlendPlan[];
	planByPcode: ReadonlyMap<number, TerrainBlendPlan>;
	diagnostics: string[];
	signature: string;
}

export interface TerrainBlendPlan {
	pcode: number;
	base: TerrainBlendTextureRef;
	overlays: TerrainTextureOverlay[];
	roads: TerrainRoadOverlay[];
	allRoad: boolean;
}

export interface TerrainBlendTextureRef {
	textureAssetId: string;
	renderSurface: PreparedRenderSurfacePayload;
	tiling: number;
	wrap: "repeat" | "clamp";
	role: "color" | "mask";
}

interface TerrainTextureOverlay {
	terrain: TerrainBlendTextureRef;
	alpha: TerrainBlendTextureRef;
	rotation: number;
}

interface TerrainRoadOverlay {
	road: TerrainBlendTextureRef;
	alpha: TerrainBlendTextureRef;
	rotation: number;
}

interface TerrainBlendPlanShape {
	pcode: number;
	base: PreparedTerrainMaterialTypeEntry;
	overlays: Array<{
		terrain: PreparedTerrainMaterialTypeEntry;
		alpha: PreparedTerrainAlphaSelection;
	}>;
	roads: Array<{
		road: PreparedTerrainRoadAlphaMapEntry;
		rotation: number;
		tiling: number;
	}>;
	allRoad: boolean;
}

interface PreparedTerrainAlphaSelection {
	alphaTextureAssetId: string;
	rotation: number;
}

const TERRAIN_CODE_MASK = 0x1f;
const ROAD_CORNER_MASKS = [0x0c00_0000, 0x0300_0000, 0x00c0_0000, 0x0030_0000];
const ROAD_TYPE_TERRAIN_CODE = 3;

export function buildTerrainBlendPlanSet(options: {
	assetReadModel: RendererAssetReadModel;
	regionNumber: number;
	pcodes: readonly number[];
}): TerrainBlendPlanSet | null {
	const tableAssetId = `terrain-material/${Math.trunc(options.regionNumber)}`;
	const tableRecord = options.assetReadModel.get(tableAssetId);
	if (tableRecord?.payload.kind !== "terrain-material") {
		return null;
	}

	const table = tableRecord.payload;
	const terrainByCode = new Map(
		table.terrainTypes.map((terrain) => [terrain.terrainType, terrain]),
	);
	const pcodes = [...new Set(options.pcodes)].sort(compareNumbers);
	const diagnostics: string[] = [];
	const plans: TerrainBlendPlan[] = [];
	const planByPcode = new Map<number, TerrainBlendPlan>();

	for (const pcode of pcodes) {
		const planShape = buildTerrainBlendPlanShape({
			table,
			terrainByCode,
			pcode,
		});
		if (!planShape) {
			diagnostics.push(`Could not resolve terrain pcode ${pcode}.`);
			continue;
		}
		const plan = resolveTerrainBlendPlanTextures({
			assetReadModel: options.assetReadModel,
			plan: planShape,
			diagnostics,
		});
		if (!plan) {
			continue;
		}
		plans.push(plan);
		planByPcode.set(pcode, plan);
	}

	if (plans.length === 0) {
		return null;
	}
	return {
		plans,
		planByPcode,
		diagnostics,
		signature: [
			tableAssetId,
			`pcodes:${pcodes.join(",")}`,
			`plans:${plans.length}`,
			`diag:${diagnostics.length}`,
		].join("|"),
	};
}

function buildTerrainBlendPlanShape(options: {
	table: PreparedTerrainMaterialTablePayload;
	terrainByCode: ReadonlyMap<number, PreparedTerrainMaterialTypeEntry>;
	pcode: number;
}): TerrainBlendPlanShape | null {
	const terrainCodes = decodeTerrainCodes(options.pcode);
	const roadCodes = decodeRoadCodes(options.pcode);
	const roadTerrain = getTerrain(options.terrainByCode, ROAD_TYPE_TERRAIN_CODE);
	if (roadCodes.allRoad && roadTerrain) {
		return {
			pcode: options.pcode,
			base: roadTerrain,
			overlays: [],
			roads: [],
			allRoad: true,
		};
	}

	const terrainLayers = selectTerrainLayers(terrainCodes);
	const base = getTerrain(options.terrainByCode, terrainLayers.baseCode);
	if (!base) {
		return null;
	}
	const overlays = terrainLayers.overlayCodes.flatMap((overlayCode) => {
		const terrain = getTerrain(options.terrainByCode, overlayCode.terrainCode);
		const alpha = selectTerrainAlpha({
			pcode: options.pcode,
			tcode: overlayCode.tcode,
			table: options.table,
		});
		return terrain && alpha ? [{ terrain, alpha }] : [];
	});
	const roads =
		roadTerrain && roadCodes.codes.length > 0
			? roadCodes.codes.flatMap((rcode) => {
					const road = selectRoadAlpha({
						pcode: options.pcode,
						rcode,
						table: options.table,
					});
					return road
						? [{ ...road, tiling: normalizeTiling(roadTerrain.tiling) }]
						: [];
				})
			: [];
	return {
		pcode: options.pcode,
		base,
		overlays,
		roads,
		allRoad: false,
	};
}

function resolveTerrainBlendPlanTextures(options: {
	assetReadModel: RendererAssetReadModel;
	plan: TerrainBlendPlanShape;
	diagnostics: string[];
}): TerrainBlendPlan | null {
	const base = resolveTerrainTexture({
		assetReadModel: options.assetReadModel,
		textureAssetId: options.plan.base.textureAssetId,
		tiling: normalizeTiling(options.plan.base.tiling),
		wrap: "repeat",
		role: "color",
		diagnostics: options.diagnostics,
	});
	if (!base) {
		return null;
	}
	const overlays = options.plan.overlays.flatMap((overlay) => {
		const terrain = resolveTerrainTexture({
			assetReadModel: options.assetReadModel,
			textureAssetId: overlay.terrain.textureAssetId,
			tiling: normalizeTiling(overlay.terrain.tiling),
			wrap: "repeat",
			role: "color",
			diagnostics: options.diagnostics,
		});
		const alpha = resolveTerrainTexture({
			assetReadModel: options.assetReadModel,
			textureAssetId: overlay.alpha.alphaTextureAssetId,
			tiling: 1,
			wrap: "clamp",
			role: "mask",
			diagnostics: options.diagnostics,
		});
		return terrain && alpha
			? [{ terrain, alpha, rotation: overlay.alpha.rotation }]
			: [];
	});
	const roadTextureAssetId =
		options.plan.roads[0]?.road.roadTextureAssetId ?? null;
	const road = roadTextureAssetId
		? resolveTerrainTexture({
				assetReadModel: options.assetReadModel,
				textureAssetId: roadTextureAssetId,
				tiling: options.plan.roads[0]?.tiling ?? 1,
				wrap: "repeat",
				role: "color",
				diagnostics: options.diagnostics,
			})
		: null;
	const roads = options.plan.roads.flatMap((roadPlan) => {
		if (!road) {
			return [];
		}
		const alpha = resolveTerrainTexture({
			assetReadModel: options.assetReadModel,
			textureAssetId: roadPlan.road.alphaTextureAssetId,
			tiling: 1,
			wrap: "clamp",
			role: "mask",
			diagnostics: options.diagnostics,
		});
		return alpha ? [{ road, alpha, rotation: roadPlan.rotation }] : [];
	});
	return {
		pcode: options.plan.pcode,
		base,
		overlays,
		roads,
		allRoad: options.plan.allRoad,
	};
}

function resolveTerrainTexture(options: {
	assetReadModel: RendererAssetReadModel;
	textureAssetId: string;
	tiling: number;
	wrap: TerrainBlendTextureRef["wrap"];
	role: TerrainBlendTextureRef["role"];
	diagnostics: string[];
}): TerrainBlendTextureRef | null {
	const surfaceTexture = getSurfaceTexture(
		options.assetReadModel,
		options.textureAssetId,
	);
	if (!surfaceTexture) {
		options.diagnostics.push(
			`Missing terrain surface texture ${options.textureAssetId}.`,
		);
		return null;
	}
	const renderSurface = getSelectedRenderSurface(
		options.assetReadModel,
		surfaceTexture,
	);
	if (!renderSurface) {
		options.diagnostics.push(
			`Missing selected render surface for terrain texture ${options.textureAssetId}.`,
		);
		return null;
	}
	return {
		textureAssetId: options.textureAssetId,
		renderSurface,
		tiling: options.tiling,
		wrap: options.wrap,
		role: options.role,
	};
}

function getSurfaceTexture(
	assetReadModel: RendererAssetReadModel,
	assetId: string,
): PreparedSurfaceTexturePayload | null {
	const record = assetReadModel.get(assetId);
	return record?.payload.kind === "surface-texture" ? record.payload : null;
}

function getSelectedRenderSurface(
	assetReadModel: RendererAssetReadModel,
	surfaceTexture: PreparedSurfaceTexturePayload,
): PreparedRenderSurfacePayload | null {
	const renderSurfaceIds = preferredRenderSurfaceIds(surfaceTexture);
	for (const renderSurfaceId of renderSurfaceIds) {
		const assetId = `render-surface/${formatHex32(renderSurfaceId)}`;
		const record = assetReadModel.get(assetId);
		if (record?.payload.kind === "render-surface") {
			return record.payload;
		}
	}
	return null;
}

function preferredRenderSurfaceIds(
	surfaceTexture: PreparedSurfaceTexturePayload,
): number[] {
	const fallbackIds =
		surfaceTexture.selectedRenderSurfaceId === null
			? []
			: [surfaceTexture.selectedRenderSurfaceId];
	return [...fallbackIds, ...surfaceTexture.renderSurfaceIds];
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
	baseCode: number;
	overlayCodes: Array<{ terrainCode: number; tcode: number }>;
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
			terrainCode,
			tcode: 1 << (index + 1),
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
	const overlayCodes: Array<{ terrainCode: number; tcode: number }> = [];
	for (let index = 0; index < terrainCodes.length; index += 1) {
		const terrainCode = terrainCodes[index] ?? 0;
		if (terrainCode === baseCode) {
			continue;
		}
		if (firstOverlayTcode === 0) {
			firstOverlayCode = terrainCode;
			firstOverlayTcode = 1 << index;
			overlayCodes.push({ terrainCode, tcode: firstOverlayTcode });
			continue;
		}
		if (
			firstOverlayCode === terrainCode &&
			firstOverlayTcode === 1 << (index - 1)
		) {
			overlayCodes[0] = {
				terrainCode,
				tcode: firstOverlayTcode + (1 << index),
			};
		} else {
			overlayCodes.push({ terrainCode, tcode: 1 << index });
		}
		break;
	}
	return { baseCode, overlayCodes };
}

interface RoadCodeSelection {
	allRoad: boolean;
	codes: number[];
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

function selectTerrainAlpha(options: {
	pcode: number;
	tcode: number;
	table: PreparedTerrainMaterialTablePayload;
}): PreparedTerrainAlphaSelection | null {
	const terrainMaps = options.table.terrainAlphaMaps.filter((map) =>
		isSideTerrainTcode(options.tcode)
			? map.alphaIndex >= 4
			: map.alphaIndex < 4,
	);
	if (terrainMaps.length === 0) {
		return null;
	}
	const startIndex = terrainPrngIndex(options.pcode, terrainMaps.length);
	for (let offset = 0; offset < terrainMaps.length; offset += 1) {
		const map = terrainMaps[(startIndex + offset) % terrainMaps.length];
		if (!map) {
			continue;
		}
		const rotation = findRotatedSelector(map.selector, options.tcode);
		if (rotation !== null) {
			return {
				alphaTextureAssetId: map.alphaTextureAssetId,
				rotation,
			};
		}
	}
	return null;
}

function selectRoadAlpha(options: {
	pcode: number;
	rcode: number;
	table: PreparedTerrainMaterialTablePayload;
}): {
	road: PreparedTerrainRoadAlphaMapEntry;
	rotation: number;
	tiling: number;
} | null {
	const roadMaps = options.table.roadAlphaMaps;
	if (roadMaps.length === 0) {
		return null;
	}
	const startIndex = terrainPrngIndex(options.pcode, roadMaps.length);
	for (let offset = 0; offset < roadMaps.length; offset += 1) {
		const map = roadMaps[(startIndex + offset) % roadMaps.length];
		if (!map) {
			continue;
		}
		const rotation = findRotatedSelector(map.selector, options.rcode);
		if (rotation !== null) {
			return { road: map, rotation, tiling: 1 };
		}
	}
	return null;
}

function terrainPrngIndex(pcode: number, count: number): number {
	const mixed = (Math.imul(1379576222, pcode) - 1372186442) >>> 0;
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

function getTerrain(
	terrainByCode: ReadonlyMap<number, PreparedTerrainMaterialTypeEntry>,
	terrainCode: number,
): PreparedTerrainMaterialTypeEntry | null {
	return terrainByCode.get(terrainCode) ?? null;
}

function normalizeTiling(tiling: number): number {
	return Math.max(tiling, 1);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}
