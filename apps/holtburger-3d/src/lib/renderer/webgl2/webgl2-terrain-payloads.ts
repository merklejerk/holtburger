import type {
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import type { TextureBindingId } from "../../textures/identity";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import type {
	RendererTextureBindingState,
	ResidentRendererTextureBinding,
} from "./webgl2-texture-bindings";

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
	textureBindings: TerrainTextureBindingLookup,
): TerrainPreparedLayeredPayload | null {
	if (!state.isDirty) {
		return state.payload;
	}

	if (!prepareTerrainLayeredPayload(state.payload, plan, textureBindings)) {
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
	textureBindings: TerrainTextureBindingLookup,
): boolean {
	resetTerrainLayeredPayload(target);
	const pageSlots = new TerrainDrawUnitRolePageSlots(plan.signature);
	const textureResources = createTerrainTextureResources(plan, textureBindings);

	for (const entry of plan.layerEntries) {
		if (
			!collectTerrainPageBinding(
				entry.base,
				textureResources,
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
					textureResources,
					pageSlots,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					overlay.alpha,
					textureResources,
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
					textureResources,
					pageSlots,
					target.colorPages,
					target.maskPages,
				) ||
				!collectTerrainPageBinding(
					road.alpha,
					textureResources,
					pageSlots,
					target.colorPages,
					target.maskPages,
				)
			) {
				return false;
			}
		}
	}

	const detailResource = resolveDetailPlacement(plan, textureResources);
	if (detailResource === false) {
		return false;
	}
	const detailTexture = detailResource?.texture ?? null;

	fillTerrainLayerRects(target.layerRects, plan, textureResources, pageSlots);
	fillTerrainDetailUniforms(
		target.detail,
		plan,
		textureResources,
		detailResource,
	);
	target.detail.texture = detailTexture;
	target.detail.atlasSize[0] = detailResource?.placement.textureWidth ?? 1;
	target.detail.atlasSize[1] = detailResource?.placement.textureHeight ?? 1;

	return true;
}

export interface TerrainTextureBindingLookup {
	getResident(
		bindingId: TextureBindingId,
	): ResidentRendererTextureBinding | null;
	getState?(bindingId: TextureBindingId): RendererTextureBindingState;
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

function createTerrainTextureResources(
	plan: TerrainMaterialLayerPlan,
	textureBindings: TerrainTextureBindingLookup,
): ReadonlyMap<TextureBindingId, ResidentRendererTextureBinding> {
	const resources = new Map<TextureBindingId, ResidentRendererTextureBinding>();
	for (const role of collectTerrainTextureRoles(plan)) {
		if (!role.textureBindingId || resources.has(role.textureBindingId)) {
			continue;
		}
		const resident = textureBindings.getResident(role.textureBindingId);
		if (resident) {
			resources.set(role.textureBindingId, resident);
		}
	}
	return resources;
}

function collectTerrainTextureRoles(
	plan: TerrainMaterialLayerPlan,
): readonly TerrainMaterialTextureRoleBinding[] {
	return [
		...plan.detailRoles.map((role) => role.texture),
		...plan.layerEntries.flatMap((entry) => [
			entry.base,
			...entry.overlays.flatMap((overlay) => [overlay.terrain, overlay.alpha]),
			...entry.roads.flatMap((road) => [road.road, road.alpha]),
		]),
	];
}

function collectTerrainPageBinding(
	role: TerrainMaterialTextureRoleBinding,
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
	pageSlots: TerrainDrawUnitRolePageSlots,
	colorPages: TerrainPreparedRolePageBindings,
	maskPages: TerrainPreparedRolePageBindings,
): boolean {
	if (!role.textureBindingId) {
		return false;
	}
	const resource = textureResources.get(role.textureBindingId);
	if (!resource) {
		return false;
	}
	const { placement, texture } = resource;
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
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
): ResidentRendererTextureBinding | null | false {
	let detailResource: ResidentRendererTextureBinding | null = null;
	for (const detailRole of plan.detailRoles) {
		const resource = detailRole.texture.textureBindingId
			? textureResources.get(detailRole.texture.textureBindingId)
			: undefined;
		if (!resource) {
			return false;
		}
		const placement = resource.placement;
		if (
			detailResource &&
			(detailResource.placement.pageVersion.textureRefId !==
				placement.pageVersion.textureRefId ||
				detailResource.placement.pageVersion.placementRevision !==
					placement.pageVersion.placementRevision)
		) {
			return false;
		}
		detailResource = resource;
	}

	return detailResource;
}

function fillTerrainLayerRects(
	target: TerrainPreparedLayerRects,
	plan: TerrainMaterialLayerPlan,
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
	pageSlots: TerrainDrawUnitRolePageSlots,
): void {
	for (const layer of plan.layerEntries) {
		target.baseColorRects.set(
			resolvePlacementRect(textureResources, layer.base),
			layer.slot * 4,
		);
		target.baseColorPages[layer.slot] = resolvePlacementPage(
			textureResources,
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
				resolvePlacementRect(textureResources, overlay.terrain),
				index * 4,
			);
			target.overlayColorPages[index] = resolvePlacementPage(
				textureResources,
				pageSlots,
				overlay.terrain,
			);
			target.overlayMaskRects.set(
				resolvePlacementRect(textureResources, overlay.alpha),
				index * 4,
			);
			target.overlayMaskPages[index] = resolvePlacementPage(
				textureResources,
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
				resolvePlacementRect(textureResources, roadTexture),
				layer.slot * 4,
			);
			target.roadColorPages[layer.slot] = resolvePlacementPage(
				textureResources,
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
				resolvePlacementRect(textureResources, road.alpha),
				index * 4,
			);
			target.roadMaskPages[index] = resolvePlacementPage(
				textureResources,
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
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
	detailResource: ResidentRendererTextureBinding | null,
): void {
	const detailRole = plan.detailRoles[0] ?? null;
	target.isEnabled = Boolean(detailRole && detailResource);
	target.atlasRect.set(
		detailRole
			? resolvePlacementRect(textureResources, detailRole.texture)
			: DEFAULT_TEXTURE_RECT,
	);
	target.tiling = detailRole?.texture.tiling ?? 1;
	target.fadeNear = detailRole?.fadeNear ?? 0;
	target.fadeFar = detailRole?.fadeFar ?? 1;
}

function resolvePlacementRect(
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
	role: TerrainMaterialTextureRoleBinding,
): readonly [number, number, number, number] {
	if (!role.textureBindingId) {
		return DEFAULT_TEXTURE_RECT;
	}

	return (
		textureResources.get(role.textureBindingId)?.placement.rect ??
		DEFAULT_TEXTURE_RECT
	);
}

function resolvePlacementPage(
	textureResources: ReadonlyMap<
		TextureBindingId,
		ResidentRendererTextureBinding
	>,
	pageSlots: TerrainDrawUnitRolePageSlots,
	role: TerrainMaterialTextureRoleBinding,
): number {
	if (!role.textureBindingId) {
		return 0;
	}

	const resource = textureResources.get(role.textureBindingId);
	if (!resource) {
		return 0;
	}
	return pageSlots.resolveSlot(
		createTerrainRolePageKind(role),
		resource.placement.textureRefId,
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
