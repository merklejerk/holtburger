import type {
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import type { ResolvedTexturePlacement } from "../types";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";

export const TERRAIN_LAYERED_MAX_LAYER_ENTRIES = 8;
export const TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER = 3;
export const TERRAIN_LAYERED_MAX_ROADS_PER_LAYER = 2;

const DEFAULT_TEXTURE_RECT = [0, 0, 1, 1] as const;

export interface TerrainPreparedLayeredPayload {
	readonly colorPages: TerrainPreparedRolePageBindings;
	readonly detail: TerrainPreparedDetailUniforms;
	readonly layerRects: TerrainPreparedLayerRects;
	readonly maskPages: TerrainPreparedRolePageBindings;
}

export interface TerrainPreparedLayeredPayloadState {
	readonly payload: TerrainPreparedLayeredPayload;
	isDirty: boolean;
}

export interface TerrainPreparedRolePageBindings {
	readonly sizes: Float32Array;
	readonly textures: (WebGLTexture | null)[];
}

export interface TerrainPreparedDetailUniforms {
	readonly atlasRect: Float32Array;
	readonly atlasSize: Float32Array;
	fadeFar: number;
	fadeNear: number;
	isEnabled: boolean;
	texture: WebGLTexture | null;
	tiling: number;
}

export interface TerrainPreparedLayerRects {
	readonly baseColorPages: Int32Array;
	readonly baseColorRects: Float32Array;
	readonly baseTilings: Float32Array;
	readonly overlayColorPages: Int32Array;
	readonly overlayColorRects: Float32Array;
	readonly overlayCounts: Int32Array;
	readonly overlayMaskPages: Int32Array;
	readonly overlayMaskRects: Float32Array;
	readonly overlayRotations: Int32Array;
	readonly overlayTilings: Float32Array;
	readonly roadColorPages: Int32Array;
	readonly roadColorRects: Float32Array;
	readonly roadCounts: Int32Array;
	readonly roadMaskPages: Int32Array;
	readonly roadMaskRects: Float32Array;
	readonly roadRotations: Int32Array;
	readonly roadTilings: Float32Array;
}

export function createTerrainPreparedLayeredPayloadState(): TerrainPreparedLayeredPayloadState {
	return {
		isDirty: true,
		payload: createTerrainPreparedLayeredPayload(),
	};
}

export function markTerrainPreparedLayeredPayloadDirty(
	state: TerrainPreparedLayeredPayloadState,
): void {
	state.isDirty = true;
}

export function prepareTerrainLayeredPayloadState(
	state: TerrainPreparedLayeredPayloadState,
	plan: TerrainMaterialLayerPlan,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	textures: ReadonlyMap<string, WebGLTexture>,
): TerrainPreparedLayeredPayload | null {
	if (!state.isDirty) {
		return state.payload;
	}

	if (!prepareTerrainLayeredPayload(state.payload, plan, placements, textures)) {
		return null;
	}
	state.isDirty = false;

	return state.payload;
}

export function createTerrainPreparedLayeredPayload(): TerrainPreparedLayeredPayload {
	return {
		colorPages: createTerrainRolePageScratch(MAX_TERRAIN_COLOR_PAGES_PER_DRAW),
		detail: {
			atlasRect: new Float32Array(DEFAULT_TEXTURE_RECT),
			atlasSize: new Float32Array([1, 1]),
			fadeFar: 1,
			fadeNear: 0,
			isEnabled: false,
			texture: null,
			tiling: 1,
		},
		layerRects: createTerrainLayerRectScratch(),
		maskPages: createTerrainRolePageScratch(MAX_TERRAIN_MASK_PAGES_PER_DRAW),
	};
}

export function prepareTerrainLayeredPayload(
	target: TerrainPreparedLayeredPayload,
	plan: TerrainMaterialLayerPlan,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	textures: ReadonlyMap<string, WebGLTexture>,
): boolean {
	resetTerrainLayeredPayload(target);
	const pageSlots = new TerrainDrawUnitRolePageSlots(plan.signature);

	for (const entry of plan.layerEntries) {
		if (
			!collectTerrainPageBinding(
				entry.base,
				placements,
				textures,
				pageSlots,
				target.colorPages,
				target.maskPages,
			)
		) {
			return false;
		}
		for (const overlay of entry.overlays) {
			if (
				!collectTerrainPageBinding(
					overlay.terrain,
					placements,
					textures,
					pageSlots,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					overlay.alpha,
					placements,
					textures,
					pageSlots,
					target.colorPages,
					target.maskPages,
				)
			) {
				return false;
			}
		}
		for (const road of entry.roads) {
			if (
				!collectTerrainPageBinding(
					road.road,
					placements,
					textures,
					pageSlots,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					road.alpha,
					placements,
					textures,
					pageSlots,
					target.colorPages,
					target.maskPages,
				)
			) {
				return false;
			}
		}
	}

	const detailPlacement = resolveDetailPlacement(plan, placements);
	if (detailPlacement === false) {
		return false;
	}
	const detailTexture = detailPlacement
		? (textures.get(detailPlacement.textureRefId) ?? null)
		: null;
	if (detailPlacement && !detailTexture) {
		return false;
	}

	fillTerrainLayerRects(target.layerRects, plan, placements, pageSlots);
	fillTerrainDetailUniforms(target.detail, plan, placements, detailPlacement);
	target.detail.texture = detailTexture;
	target.detail.atlasSize[0] = detailPlacement?.textureWidth ?? 1;
	target.detail.atlasSize[1] = detailPlacement?.textureHeight ?? 1;

	return true;
}

function createTerrainRolePageScratch(
	slotCount: number,
): TerrainPreparedRolePageBindings {
	return {
		sizes: new Float32Array(slotCount * 2),
		textures: Array.from({ length: slotCount }, () => null),
	};
}

function createTerrainLayerRectScratch(): TerrainPreparedLayerRects {
	return {
		baseColorPages: new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
		baseColorRects: new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4),
		baseTilings: new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
		overlayColorPages: new Int32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		),
		overlayColorRects: new Float32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
				4,
		),
		overlayCounts: new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
		overlayMaskPages: new Int32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		),
		overlayMaskRects: new Float32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
				4,
		),
		overlayRotations: new Int32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		),
		overlayTilings: new Float32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		),
		roadColorPages: new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
		roadColorRects: new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4),
		roadCounts: new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
		roadMaskPages: new Int32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
		),
		roadMaskRects: new Float32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
				TERRAIN_LAYERED_MAX_ROADS_PER_LAYER *
				4,
		),
		roadRotations: new Int32Array(
			TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
		),
		roadTilings: new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES),
	};
}

function resetTerrainLayeredPayload(
	target: TerrainPreparedLayeredPayload,
): void {
	resetTerrainRolePages(target.colorPages);
	resetTerrainRolePages(target.maskPages);
	resetTerrainLayerRects(target.layerRects);
	target.detail.atlasRect.set(DEFAULT_TEXTURE_RECT);
	target.detail.atlasSize[0] = 1;
	target.detail.atlasSize[1] = 1;
	target.detail.fadeFar = 1;
	target.detail.fadeNear = 0;
	target.detail.isEnabled = false;
	target.detail.texture = null;
	target.detail.tiling = 1;
}

function resetTerrainRolePages(
	rolePages: TerrainPreparedRolePageBindings,
): void {
	rolePages.textures.fill(null);
	for (let slot = 0; slot < rolePages.textures.length; slot += 1) {
		rolePages.sizes[slot * 2] = 1;
		rolePages.sizes[slot * 2 + 1] = 1;
	}
}

function resetTerrainLayerRects(layerRects: TerrainPreparedLayerRects): void {
	layerRects.baseColorPages.fill(0);
	layerRects.baseColorRects.fill(0);
	layerRects.baseTilings.fill(0);
	layerRects.overlayColorPages.fill(0);
	layerRects.overlayColorRects.fill(0);
	layerRects.overlayCounts.fill(0);
	layerRects.overlayMaskPages.fill(0);
	layerRects.overlayMaskRects.fill(0);
	layerRects.overlayRotations.fill(0);
	layerRects.overlayTilings.fill(0);
	layerRects.roadColorPages.fill(0);
	layerRects.roadColorRects.fill(0);
	layerRects.roadCounts.fill(0);
	layerRects.roadMaskPages.fill(0);
	layerRects.roadMaskRects.fill(0);
	layerRects.roadRotations.fill(0);
	layerRects.roadTilings.fill(0);
}

function collectTerrainPageBinding(
	role: TerrainMaterialTextureRoleBinding,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	textures: ReadonlyMap<string, WebGLTexture>,
	pageSlots: TerrainDrawUnitRolePageSlots,
	colorPages: TerrainPreparedRolePageBindings,
	maskPages: TerrainPreparedRolePageBindings,
): boolean {
	if (!role.textureUseId) {
		return false;
	}
	const placement = placements.get(role.textureUseId);
	if (!placement) {
		return false;
	}
	const texture = textures.get(placement.textureRefId);
	if (!texture) {
		return false;
	}
	const pageKind = createTerrainRolePageKind(role);
	const pageSlot = pageSlots.resolveSlot(pageKind, placement.textureRefId);
	const pages = pageKind === "mask" ? maskPages : colorPages;
	const existingTexture = pages.textures[pageSlot] ?? null;
	if (existingTexture && existingTexture !== texture) {
		return false;
	}
	pages.textures[pageSlot] = texture;
	pages.sizes[pageSlot * 2] = placement.textureWidth;
	pages.sizes[pageSlot * 2 + 1] = placement.textureHeight;
	return true;
}

function resolveDetailPlacement(
	plan: TerrainMaterialLayerPlan,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
): ResolvedTexturePlacement | null | false {
	let detailPlacement: ResolvedTexturePlacement | null = null;
	for (const detailRole of plan.detailRoles) {
		const placement = detailRole.texture.textureUseId
			? placements.get(detailRole.texture.textureUseId)
			: undefined;
		if (!placement) {
			return false;
		}
		if (
			detailPlacement &&
			(detailPlacement.pageVersion.textureRefId !==
				placement.pageVersion.textureRefId ||
				detailPlacement.pageVersion.placementRevision !==
					placement.pageVersion.placementRevision)
		) {
			return false;
		}
		detailPlacement = placement;
	}

	return detailPlacement;
}

function fillTerrainLayerRects(
	target: TerrainPreparedLayerRects,
	plan: TerrainMaterialLayerPlan,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	pageSlots: TerrainDrawUnitRolePageSlots,
): void {
	for (const layer of plan.layerEntries) {
		target.baseColorRects.set(
			resolvePlacementRect(placements, layer.base),
			layer.slot * 4,
		);
		target.baseColorPages[layer.slot] = resolvePlacementPage(
			placements,
			pageSlots,
			layer.base,
		);
		target.baseTilings[layer.slot] = layer.base.tiling;
		const overlayCount = Math.min(
			layer.overlays.length,
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		);
		target.overlayCounts[layer.slot] = overlayCount;
		for (let overlayIndex = 0; overlayIndex < overlayCount; overlayIndex += 1) {
			const overlay = layer.overlays[overlayIndex];
			if (!overlay) {
				continue;
			}
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER + overlayIndex;
			target.overlayColorRects.set(
				resolvePlacementRect(placements, overlay.terrain),
				index * 4,
			);
			target.overlayColorPages[index] = resolvePlacementPage(
				placements,
				pageSlots,
				overlay.terrain,
			);
			target.overlayMaskRects.set(
				resolvePlacementRect(placements, overlay.alpha),
				index * 4,
			);
			target.overlayMaskPages[index] = resolvePlacementPage(
				placements,
				pageSlots,
				overlay.alpha,
			);
			target.overlayTilings[index] = overlay.terrain.tiling;
			target.overlayRotations[index] = overlay.rotation;
		}

		const roadCount = Math.min(
			layer.roads.length,
			TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
		);
		target.roadCounts[layer.slot] = roadCount;
		const roadTexture = layer.roads[0]?.road ?? null;
		if (roadTexture) {
			target.roadColorRects.set(
				resolvePlacementRect(placements, roadTexture),
				layer.slot * 4,
			);
			target.roadColorPages[layer.slot] = resolvePlacementPage(
				placements,
				pageSlots,
				roadTexture,
			);
			target.roadTilings[layer.slot] = roadTexture.tiling;
		}
		for (let roadIndex = 0; roadIndex < roadCount; roadIndex += 1) {
			const road = layer.roads[roadIndex];
			if (!road) {
				continue;
			}
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER + roadIndex;
			target.roadMaskRects.set(
				resolvePlacementRect(placements, road.alpha),
				index * 4,
			);
			target.roadMaskPages[index] = resolvePlacementPage(
				placements,
				pageSlots,
				road.alpha,
			);
			target.roadRotations[index] = road.rotation;
		}
	}
}

function fillTerrainDetailUniforms(
	target: TerrainPreparedDetailUniforms,
	plan: TerrainMaterialLayerPlan,
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	detailPlacement: ResolvedTexturePlacement | null,
): void {
	const detailRole = plan.detailRoles[0] ?? null;
	target.isEnabled = Boolean(detailRole && detailPlacement);
	target.atlasRect.set(
		detailRole
			? resolvePlacementRect(placements, detailRole.texture)
			: DEFAULT_TEXTURE_RECT,
	);
	target.tiling = detailRole?.texture.tiling ?? 1;
	target.fadeNear = detailRole?.fadeNear ?? 0;
	target.fadeFar = detailRole?.fadeFar ?? 1;
}

function resolvePlacementRect(
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	role: TerrainMaterialTextureRoleBinding,
): readonly [number, number, number, number] {
	if (!role.textureUseId) {
		return DEFAULT_TEXTURE_RECT;
	}

	return placements.get(role.textureUseId)?.rect ?? DEFAULT_TEXTURE_RECT;
}

function resolvePlacementPage(
	placements: ReadonlyMap<string, ResolvedTexturePlacement>,
	pageSlots: TerrainDrawUnitRolePageSlots,
	role: TerrainMaterialTextureRoleBinding,
): number {
	if (!role.textureUseId) {
		return 0;
	}

	const placement = placements.get(role.textureUseId);
	if (!placement) {
		return 0;
	}
	return pageSlots.resolveSlot(
		createTerrainRolePageKind(role),
		placement.textureRefId,
	);
}

type TerrainRolePageKind = "color" | "mask";

function createTerrainRolePageKind(
	role: TerrainMaterialTextureRoleBinding,
): TerrainRolePageKind {
	return role.role === "terrain-alpha" || role.role === "road-alpha"
		? "mask"
		: "color";
}

class TerrainDrawUnitRolePageSlots {
	readonly #planSignature: string;
	readonly #textureRefIdsByKind = new Map<TerrainRolePageKind, string[]>();

	constructor(planSignature: string) {
		this.#planSignature = planSignature;
	}

	resolveSlot(kind: TerrainRolePageKind, textureRefId: string): number {
		const textureRefIds = this.#textureRefIdsByKind.get(kind) ?? [];
		const existingSlot = textureRefIds.indexOf(textureRefId);
		if (existingSlot >= 0) {
			return existingSlot;
		}

		const maxSlots =
			kind === "mask"
				? MAX_TERRAIN_MASK_PAGES_PER_DRAW
				: MAX_TERRAIN_COLOR_PAGES_PER_DRAW;
		if (textureRefIds.length >= maxSlots) {
			throw new Error(
				`Terrain material plan ${this.#planSignature} exceeded ${kind} texture page capacity ${maxSlots}.`,
			);
		}

		textureRefIds.push(textureRefId);
		this.#textureRefIdsByKind.set(kind, textureRefIds);
		return textureRefIds.length - 1;
	}
}
