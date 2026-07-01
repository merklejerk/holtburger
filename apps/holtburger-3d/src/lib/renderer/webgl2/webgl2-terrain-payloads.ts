import type {
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import type { StaticTextureBinding } from "../types";
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
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): TerrainPreparedLayeredPayload | null {
	if (!state.isDirty) {
		return state.payload;
	}

	if (!prepareTerrainLayeredPayload(state.payload, plan, bindings, textures)) {
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
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): boolean {
	resetTerrainLayeredPayload(target);

	for (const entry of plan.layerEntries) {
		if (
			!collectTerrainPageBinding(
				entry.base,
				bindings,
				textures,
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
					bindings,
					textures,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					overlay.alpha,
					bindings,
					textures,
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
					bindings,
					textures,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					road.alpha,
					bindings,
					textures,
					target.colorPages,
					target.maskPages,
				)
			) {
				return false;
			}
		}
	}

	const detailBinding = resolveDetailBinding(plan, bindings);
	if (detailBinding === false) {
		return false;
	}
	const detailTexture = detailBinding
		? (textures.get(detailBinding.textureRefId) ?? null)
		: null;
	if (detailBinding && !detailTexture) {
		return false;
	}

	fillTerrainLayerRects(target.layerRects, plan, bindings);
	fillTerrainDetailUniforms(target.detail, plan, bindings, detailBinding);
	target.detail.texture = detailTexture;
	target.detail.atlasSize[0] = detailBinding?.textureWidth ?? 1;
	target.detail.atlasSize[1] = detailBinding?.textureHeight ?? 1;

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
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	colorPages: TerrainPreparedRolePageBindings,
	maskPages: TerrainPreparedRolePageBindings,
): boolean {
	if (!role.textureUseId) {
		return false;
	}
	const binding = bindings.get(role.textureUseId);
	if (!binding) {
		return false;
	}
	const texture = textures.get(binding.textureRefId);
	if (!texture) {
		return false;
	}
	const pages = binding.pageSlot.kind === "mask" ? maskPages : colorPages;
	if (
		binding.pageSlot.slot < 0 ||
		binding.pageSlot.slot >= pages.textures.length
	) {
		return false;
	}
	const existingTexture = pages.textures[binding.pageSlot.slot] ?? null;
	if (existingTexture && existingTexture !== texture) {
		return false;
	}
	pages.textures[binding.pageSlot.slot] = texture;
	pages.sizes[binding.pageSlot.slot * 2] = binding.textureWidth;
	pages.sizes[binding.pageSlot.slot * 2 + 1] = binding.textureHeight;
	return true;
}

function resolveDetailBinding(
	plan: TerrainMaterialLayerPlan,
	bindings: ReadonlyMap<string, StaticTextureBinding>,
): StaticTextureBinding | null | false {
	let detailBinding: StaticTextureBinding | null = null;
	for (const detailRole of plan.detailRoles) {
		const binding = detailRole.texture.textureUseId
			? bindings.get(detailRole.texture.textureUseId)
			: undefined;
		if (!binding) {
			return false;
		}
		if (detailBinding && detailBinding.textureRefId !== binding.textureRefId) {
			return false;
		}
		detailBinding = binding;
	}

	return detailBinding;
}

function fillTerrainLayerRects(
	target: TerrainPreparedLayerRects,
	plan: TerrainMaterialLayerPlan,
	bindings: ReadonlyMap<string, StaticTextureBinding>,
): void {
	for (const layer of plan.layerEntries) {
		target.baseColorRects.set(
			resolveBindingRect(bindings, layer.base),
			layer.slot * 4,
		);
		target.baseColorPages[layer.slot] = resolveBindingPage(
			bindings,
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
				resolveBindingRect(bindings, overlay.terrain),
				index * 4,
			);
			target.overlayColorPages[index] = resolveBindingPage(
				bindings,
				overlay.terrain,
			);
			target.overlayMaskRects.set(
				resolveBindingRect(bindings, overlay.alpha),
				index * 4,
			);
			target.overlayMaskPages[index] = resolveBindingPage(
				bindings,
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
				resolveBindingRect(bindings, roadTexture),
				layer.slot * 4,
			);
			target.roadColorPages[layer.slot] = resolveBindingPage(
				bindings,
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
				resolveBindingRect(bindings, road.alpha),
				index * 4,
			);
			target.roadMaskPages[index] = resolveBindingPage(bindings, road.alpha);
			target.roadRotations[index] = road.rotation;
		}
	}
}

function fillTerrainDetailUniforms(
	target: TerrainPreparedDetailUniforms,
	plan: TerrainMaterialLayerPlan,
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	detailBinding: StaticTextureBinding | null,
): void {
	const detailRole = plan.detailRoles[0] ?? null;
	target.isEnabled = Boolean(detailRole && detailBinding);
	target.atlasRect.set(
		detailRole
			? resolveBindingRect(bindings, detailRole.texture)
			: DEFAULT_TEXTURE_RECT,
	);
	target.tiling = detailRole?.texture.tiling ?? 1;
	target.fadeNear = detailRole?.fadeNear ?? 0;
	target.fadeFar = detailRole?.fadeFar ?? 1;
}

function resolveBindingRect(
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	role: TerrainMaterialTextureRoleBinding,
): readonly [number, number, number, number] {
	if (!role.textureUseId) {
		return DEFAULT_TEXTURE_RECT;
	}

	return bindings.get(role.textureUseId)?.rect ?? DEFAULT_TEXTURE_RECT;
}

function resolveBindingPage(
	bindings: ReadonlyMap<string, StaticTextureBinding>,
	role: TerrainMaterialTextureRoleBinding,
): number {
	if (!role.textureUseId) {
		return 0;
	}

	return bindings.get(role.textureUseId)?.pageSlot.slot ?? 0;
}
