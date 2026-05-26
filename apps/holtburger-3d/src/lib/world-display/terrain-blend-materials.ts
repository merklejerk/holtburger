import { DoubleSide, ShaderMaterial, type Material, type Texture } from "three";

import type {
	AssetChannelState,
	PreparedRenderSurfacePayload,
	PreparedSurfaceTexturePayload,
	PreparedTerrainMaterialTablePayload,
	PreparedTerrainMaterialTypeEntry,
	PreparedTerrainRoadAlphaMapEntry,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { WorldMaterialResourceCache } from "./material-resources";
import { resolveRegionDetailOverlay } from "./region-detail-overlays";
import type { TextureSamplingPolicy } from "./texture-sampling-policy";

export interface TerrainBlendMaterialSet {
	materials: Material[];
	materialIndexByPcode: ReadonlyMap<number, number>;
	diagnostics: string[];
	signature: string;
}

interface BuildTerrainBlendMaterialSetOptions {
	assetState: AssetChannelState;
	regionNumber: number;
	pcodes: readonly number[];
	materialResourceCache: WorldMaterialResourceCache;
	detailTexturesEnabled?: boolean;
}

interface TerrainBlendPlan {
	pcode: number;
	base: PreparedTerrainMaterialTypeEntry;
	overlays: TerrainTextureOverlay[];
	roads: TerrainRoadOverlay[];
	detail: TerrainDetailOverlay | null;
	allRoad: boolean;
}

interface TerrainTextureOverlay {
	terrain: PreparedTerrainMaterialTypeEntry;
	alpha: PreparedTerrainAlphaSelection;
}

interface TerrainRoadOverlay {
	road: PreparedTerrainRoadAlphaMapEntry;
	rotation: number;
	tiling: number;
}

interface PreparedTerrainAlphaSelection {
	alphaTextureAssetId: string;
	rotation: number;
}

interface TerrainDetailOverlay {
	texture: Texture;
	textureAssetId: string;
	tiling: number;
	fadeNear: number;
	fadeFar: number;
}

const TERRAIN_CODE_MASK = 0x1f;
const ROAD_CORNER_MASKS = [0x0c00_0000, 0x0300_0000, 0x00c0_0000, 0x0030_0000];
const ROAD_TYPE_TERRAIN_CODE = 3;
const RETAIL_DETAIL_FADE_NEAR = 10;
const RETAIL_DETAIL_FADE_FAR = 50;

export function buildTerrainBlendMaterialSet(
	options: BuildTerrainBlendMaterialSetOptions,
): TerrainBlendMaterialSet | null {
	const tableAssetId = `terrain-material/${Math.trunc(options.regionNumber)}`;
	const tableRecord = options.assetState.preparedByAssetId[tableAssetId];
	if (tableRecord?.payload.kind !== "terrain-material") {
		return null;
	}

	const table = tableRecord.payload;
	const terrainByCode = new Map(
		table.terrainTypes.map((terrain) => [terrain.terrainType, terrain]),
	);
	const pcodes = [...new Set(options.pcodes)].sort(compareNumbers);
	const materials: Material[] = [];
	const materialIndexByPcode = new Map<number, number>();
	const diagnostics: string[] = [];
	const landscapeDetail =
		options.detailTexturesEnabled === false
			? null
			: selectLandscapeDetail(options, diagnostics);

	for (const pcode of pcodes) {
		const plan = buildTerrainBlendPlan({
			table,
			terrainByCode,
			pcode,
			landscapeDetail,
		});
		if (!plan) {
			diagnostics.push(`Could not resolve terrain pcode ${pcode}.`);
			continue;
		}
		const material = createTerrainBlendMaterial({
			plan,
			assetState: options.assetState,
			materialResourceCache: options.materialResourceCache,
			diagnostics,
		});
		if (!material) {
			continue;
		}
		materialIndexByPcode.set(pcode, materials.length);
		materials.push(material);
	}

	if (materials.length === 0) {
		return null;
	}
	return {
		materials,
		materialIndexByPcode,
		diagnostics,
		signature: [
			tableAssetId,
			`detail:${landscapeDetail?.textureAssetId ?? "none"}`,
			`pcodes:${pcodes.join(",")}`,
			`materials:${materials.length}`,
			`diag:${diagnostics.length}`,
		].join("|"),
	};
}

function buildTerrainBlendPlan(options: {
	table: PreparedTerrainMaterialTablePayload;
	terrainByCode: ReadonlyMap<number, PreparedTerrainMaterialTypeEntry>;
	pcode: number;
	landscapeDetail: TerrainDetailOverlay | null;
}): TerrainBlendPlan | null {
	const terrainCodes = decodeTerrainCodes(options.pcode);
	const roadCodes = decodeRoadCodes(options.pcode);
	const roadTerrain = getTerrain(options.terrainByCode, ROAD_TYPE_TERRAIN_CODE);
	if (roadCodes.allRoad && roadTerrain) {
		return {
			pcode: options.pcode,
			base: roadTerrain,
			overlays: [],
			roads: [],
			detail: options.landscapeDetail,
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
		detail: options.landscapeDetail,
		allRoad: false,
	};
}

function createTerrainBlendMaterial(options: {
	plan: TerrainBlendPlan;
	assetState: AssetChannelState;
	materialResourceCache: WorldMaterialResourceCache;
	diagnostics: string[];
}): Material | null {
	const base = resolveTerrainTexture({
		textureAssetId: options.plan.base.textureAssetId,
		wrap: "repeat",
		role: "color",
		assetState: options.assetState,
		materialResourceCache: options.materialResourceCache,
		diagnostics: options.diagnostics,
	});
	if (!base) {
		return null;
	}

	const resolvedOverlays = options.plan.overlays.flatMap((overlay) => {
		const overlayTexture = resolveTerrainTexture({
			textureAssetId: overlay.terrain.textureAssetId,
			wrap: "repeat",
			role: "color",
			assetState: options.assetState,
			materialResourceCache: options.materialResourceCache,
			diagnostics: options.diagnostics,
		});
		const alphaTexture = resolveTerrainTexture({
			textureAssetId: overlay.alpha.alphaTextureAssetId,
			wrap: "clamp",
			role: "mask",
			assetState: options.assetState,
			materialResourceCache: options.materialResourceCache,
			diagnostics: options.diagnostics,
		});
		return overlayTexture && alphaTexture
			? [{ overlay, overlayTexture, alphaTexture }]
			: [];
	});
	const roadTexture =
		options.plan.roads.length > 0
			? resolveTerrainTexture({
					textureAssetId: options.plan.roads[0]?.road.roadTextureAssetId ?? "",
					wrap: "repeat",
					role: "color",
					assetState: options.assetState,
					materialResourceCache: options.materialResourceCache,
					diagnostics: options.diagnostics,
				})
			: null;
	const resolvedRoads = options.plan.roads.flatMap((road) => {
		if (!roadTexture) {
			return [];
		}
		const alphaTexture = resolveTerrainTexture({
			textureAssetId: road.road.alphaTextureAssetId,
			wrap: "clamp",
			role: "mask",
			assetState: options.assetState,
			materialResourceCache: options.materialResourceCache,
			diagnostics: options.diagnostics,
		});
		return alphaTexture ? [{ road, alphaTexture }] : [];
	});
	const detailTexture = options.plan.detail?.texture ?? null;
	const detailFadeNear = normalizeDetailFadeNear(options.plan.detail?.fadeNear);
	const detailFadeFar = normalizeDetailFadeFar(
		options.plan.detail?.fadeFar,
		detailFadeNear,
	);

	const material = new ShaderMaterial({
		name: `terrain-blend-${options.plan.pcode}`,
		uniforms: {
			baseTexture: { value: base },
			baseTiling: { value: normalizeTiling(options.plan.base.tiling) },
			overlay0: { value: resolvedOverlays[0]?.overlayTexture ?? base },
			overlay1: { value: resolvedOverlays[1]?.overlayTexture ?? base },
			overlay2: { value: resolvedOverlays[2]?.overlayTexture ?? base },
			overlayAlpha0: { value: resolvedOverlays[0]?.alphaTexture ?? base },
			overlayAlpha1: { value: resolvedOverlays[1]?.alphaTexture ?? base },
			overlayAlpha2: { value: resolvedOverlays[2]?.alphaTexture ?? base },
			overlayTiling0: {
				value: normalizeTiling(
					resolvedOverlays[0]?.overlay.terrain.tiling ?? 1,
				),
			},
			overlayTiling1: {
				value: normalizeTiling(
					resolvedOverlays[1]?.overlay.terrain.tiling ?? 1,
				),
			},
			overlayTiling2: {
				value: normalizeTiling(
					resolvedOverlays[2]?.overlay.terrain.tiling ?? 1,
				),
			},
			overlayRotation0: {
				value: resolvedOverlays[0]?.overlay.alpha.rotation ?? 0,
			},
			overlayRotation1: {
				value: resolvedOverlays[1]?.overlay.alpha.rotation ?? 0,
			},
			overlayRotation2: {
				value: resolvedOverlays[2]?.overlay.alpha.rotation ?? 0,
			},
			overlayCount: { value: resolvedOverlays.length },
			roadTexture: { value: roadTexture ?? base },
			roadTiling: { value: resolvedRoads[0]?.road.tiling ?? 1 },
			roadAlpha0: { value: resolvedRoads[0]?.alphaTexture ?? base },
			roadAlpha1: { value: resolvedRoads[1]?.alphaTexture ?? base },
			roadRotation0: { value: resolvedRoads[0]?.road.rotation ?? 0 },
			roadRotation1: { value: resolvedRoads[1]?.road.rotation ?? 0 },
			roadCount: { value: resolvedRoads.length },
			detailTexture: { value: detailTexture ?? base },
			detailTiling: {
				value: normalizeDetailTiling(options.plan.detail?.tiling),
			},
			detailFadeNear: { value: detailFadeNear },
			detailFadeFar: { value: detailFadeFar },
			detailEnabled: { value: detailTexture ? 1 : 0 },
		},
		vertexShader: TERRAIN_BLEND_VERTEX_SHADER,
		fragmentShader: TERRAIN_BLEND_FRAGMENT_SHADER,
		side: DoubleSide,
	});
	material.userData.holtburgerMaterial = {
		kind: "terrain-blend",
		pcode: options.plan.pcode,
		allRoad: options.plan.allRoad,
		terrainOverlayCount: options.plan.overlays.length,
		roadOverlayCount: options.plan.roads.length,
		detailTextureAssetId: options.plan.detail?.textureAssetId ?? null,
		detailEnabled: detailTexture !== null,
	};
	return material;
}

function selectLandscapeDetail(
	options: BuildTerrainBlendMaterialSetOptions,
	diagnostics: string[],
): TerrainDetailOverlay | null {
	const overlay = resolveRegionDetailOverlay({
		assetState: options.assetState,
		regionNumber: options.regionNumber,
		roleKind: "landscape",
		materialResourceCache: options.materialResourceCache,
		reportDiagnostic: (message) => diagnostics.push(message),
	});
	return overlay
		? {
				texture: overlay.texture,
				textureAssetId: overlay.role.textureAssetId,
				tiling: overlay.role.tiling,
				fadeNear: overlay.role.fadeNear,
				fadeFar: overlay.role.fadeFar,
			}
		: null;
}

function resolveTerrainTexture(options: {
	textureAssetId: string;
	wrap: TextureSamplingPolicy["wrapS"];
	role: "color" | "mask";
	assetState: AssetChannelState;
	materialResourceCache: WorldMaterialResourceCache;
	diagnostics: string[];
}): Texture | null {
	const surfaceTexture = getSurfaceTexture(
		options.assetState,
		options.textureAssetId,
	);
	if (!surfaceTexture) {
		options.diagnostics.push(
			`Missing terrain surface texture ${options.textureAssetId}.`,
		);
		return null;
	}
	const renderSurface = getSelectedRenderSurface(
		options.assetState,
		surfaceTexture,
	);
	if (!renderSurface) {
		options.diagnostics.push(
			`Missing selected render surface for terrain texture ${options.textureAssetId}.`,
		);
		return null;
	}
	const samplingPolicy =
		options.materialResourceCache.getDefaultTextureSamplingPolicy(
			renderSurface,
		);
	return options.materialResourceCache.getTexture({
		renderSurface,
		samplingPolicy: {
			...samplingPolicy,
			wrapS: options.wrap,
			wrapT: options.wrap,
			colorSpace: options.role === "mask" ? "none" : samplingPolicy.colorSpace,
		},
	});
}

function getSurfaceTexture(
	assetState: AssetChannelState,
	assetId: string,
): PreparedSurfaceTexturePayload | null {
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "surface-texture" ? record.payload : null;
}

function getSelectedRenderSurface(
	assetState: AssetChannelState,
	surfaceTexture: PreparedSurfaceTexturePayload,
): PreparedRenderSurfacePayload | null {
	if (surfaceTexture.selectedRenderSurfaceId === null) {
		return null;
	}
	const assetId = `render-surface/${formatHex32(surfaceTexture.selectedRenderSurfaceId)}`;
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "render-surface" ? record.payload : null;
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
}): TerrainRoadOverlay | null {
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
	// Match TexMerge's 32-bit pcode mixer; plain JS multiplication loses
	// precision for the full pcode range.
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

function normalizeDetailTiling(tiling: number | undefined): number {
	if (tiling === undefined) {
		return 1;
	}
	return Math.max(tiling, 1);
}

function normalizeDetailFadeNear(fadeNear: number | undefined): number {
	return fadeNear && fadeNear > 0 ? fadeNear : RETAIL_DETAIL_FADE_NEAR;
}

function normalizeDetailFadeFar(
	fadeFar: number | undefined,
	fadeNear: number,
): number {
	return fadeFar && fadeFar > fadeNear ? fadeFar : RETAIL_DETAIL_FADE_FAR;
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

const TERRAIN_BLEND_VERTEX_SHADER = `
varying vec2 vUv;
varying float vViewDepth;

void main() {
	vUv = uv;
	vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
	vViewDepth = -viewPosition.z;
	gl_Position = projectionMatrix * viewPosition;
}
`;

const TERRAIN_BLEND_FRAGMENT_SHADER = `
uniform sampler2D baseTexture;
uniform float baseTiling;
uniform sampler2D overlay0;
uniform sampler2D overlay1;
uniform sampler2D overlay2;
uniform sampler2D overlayAlpha0;
uniform sampler2D overlayAlpha1;
uniform sampler2D overlayAlpha2;
uniform float overlayTiling0;
uniform float overlayTiling1;
uniform float overlayTiling2;
uniform int overlayRotation0;
uniform int overlayRotation1;
uniform int overlayRotation2;
uniform int overlayCount;
uniform sampler2D roadTexture;
uniform float roadTiling;
uniform sampler2D roadAlpha0;
uniform sampler2D roadAlpha1;
uniform int roadRotation0;
uniform int roadRotation1;
uniform int roadCount;
uniform sampler2D detailTexture;
uniform float detailTiling;
uniform float detailFadeNear;
uniform float detailFadeFar;
uniform int detailEnabled;
varying vec2 vUv;
varying float vViewDepth;

vec2 legacyAlphaUv(vec2 uv) {
	return vec2(uv.x, 1.0 - uv.y);
}

vec2 rotateLegacyAlphaUv(vec2 uv, int rotation) {
	if (rotation == 1) {
		return vec2(1.0 - uv.y, uv.x);
	}
	if (rotation == 2) {
		return vec2(1.0 - uv.x, 1.0 - uv.y);
	}
	if (rotation == 3) {
		return vec2(uv.y, 1.0 - uv.x);
	}
	return uv;
}

vec4 blendOverlay(vec4 baseColor, sampler2D overlayTexture, sampler2D alphaTexture, float tiling, int rotation) {
	vec4 overlayColor = texture2D(overlayTexture, vUv * tiling);
	float alpha = texture2D(alphaTexture, rotateLegacyAlphaUv(legacyAlphaUv(vUv), rotation)).r;
	return mix(baseColor, overlayColor, clamp(1.0 - alpha, 0.0, 1.0));
}

float detailDepthFade() {
	return clamp((detailFadeFar - vViewDepth) / (detailFadeFar - detailFadeNear), 0.0, 1.0);
}

vec3 applyDetailOverlay(vec3 baseColor) {
	vec4 detailColor = texture2D(detailTexture, vUv * detailTiling);
	return mix(baseColor, detailColor.rgb, clamp(detailColor.a * detailDepthFade(), 0.0, 1.0));
}

void main() {
	vec4 color = texture2D(baseTexture, vUv * baseTiling);
	if (overlayCount > 0) {
		color = blendOverlay(color, overlay0, overlayAlpha0, overlayTiling0, overlayRotation0);
	}
	if (overlayCount > 1) {
		color = blendOverlay(color, overlay1, overlayAlpha1, overlayTiling1, overlayRotation1);
	}
	if (overlayCount > 2) {
		color = blendOverlay(color, overlay2, overlayAlpha2, overlayTiling2, overlayRotation2);
	}
	if (roadCount > 0) {
		vec4 roadColor = texture2D(roadTexture, vUv * roadTiling);
		float roadAlpha = 1.0 - texture2D(roadAlpha0, rotateLegacyAlphaUv(legacyAlphaUv(vUv), roadRotation0)).r;
		if (roadCount > 1) {
			roadAlpha = 1.0 - (
				texture2D(roadAlpha0, rotateLegacyAlphaUv(legacyAlphaUv(vUv), roadRotation0)).r *
				texture2D(roadAlpha1, rotateLegacyAlphaUv(legacyAlphaUv(vUv), roadRotation1)).r
			);
		}
		color = mix(color, roadColor, clamp(roadAlpha, 0.0, 1.0));
	}
	if (detailEnabled > 0) {
		color.rgb = applyDetailOverlay(color.rgb);
	}
	gl_FragColor = vec4(color.rgb, 1.0);
}
`;
