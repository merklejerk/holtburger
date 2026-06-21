import type { StaticMaterialTableEntry } from "../../static/contracts";
import type { TextureDrawUnitBinding } from "../types";
import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
} from "../types";

const DEFAULT_TEXTURE_RECT = [0, 0, 1, 1] as const;

export interface StaticObjectMaterialPayloadResource {
	readonly drawUnitId: string;
	readonly materialFamily: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly materialEntries: readonly StaticMaterialTableEntry[];
}

export interface StaticObjectPreparedDrawPayload {
	readonly materialUniforms: StaticObjectPreparedMaterialUniforms;
	readonly rolePages: StaticObjectPreparedRolePageBindingsByRole;
}

export interface StaticObjectPreparedRolePageBindingsByRole {
	readonly baseColor: StaticObjectPreparedRolePageBindings;
	readonly detail: StaticObjectPreparedRolePageBindings;
	readonly index: StaticObjectPreparedRolePageBindings;
	readonly palette: StaticObjectPreparedRolePageBindings;
}

export interface StaticObjectPreparedRolePageBindings {
	readonly sizes: Float32Array;
	readonly textures: (WebGLTexture | null)[];
}

export interface StaticObjectPreparedMaterialUniforms {
	readonly alphaTests: Float32Array;
	readonly baseColorPages: Int32Array;
	readonly baseColorRects: Float32Array;
	readonly colors: Float32Array;
	readonly detailEnabled: Int32Array;
	readonly detailPages: Int32Array;
	readonly detailRects: Float32Array;
	readonly detailTilings: Float32Array;
	readonly emissiveColors: Float32Array;
	readonly indexedClipThresholds: Float32Array;
	readonly indexedTextureFormats: Int32Array;
	readonly indexPages: Int32Array;
	readonly indexRects: Float32Array;
	readonly materialModes: Int32Array;
	readonly paletteFirstIndices: Float32Array;
	readonly palettePages: Int32Array;
	readonly paletteRects: Float32Array;
	readonly wrapModes: Int32Array;
}

export interface StaticObjectPreparedDrawPayloadState {
	readonly payload: StaticObjectPreparedDrawPayload;
	isDirty: boolean;
}

export function createStaticObjectPreparedDrawPayloadState(): StaticObjectPreparedDrawPayloadState {
	return {
		isDirty: true,
		payload: createStaticObjectPreparedDrawPayload(),
	};
}

export function markStaticObjectPreparedDrawPayloadDirty(
	state: StaticObjectPreparedDrawPayloadState,
): void {
	state.isDirty = true;
}

export function prepareStaticObjectDrawPayloadState(
	state: StaticObjectPreparedDrawPayloadState,
	resource: StaticObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): StaticObjectPreparedDrawPayload {
	if (state.isDirty) {
		prepareStaticObjectDrawPayload(state.payload, resource, bindings, textures);
		state.isDirty = false;
	}

	return state.payload;
}

export function createStaticObjectPreparedDrawPayload(): StaticObjectPreparedDrawPayload {
	return {
		materialUniforms: createStaticObjectMaterialUniformScratch(),
		rolePages: {
			baseColor: createStaticObjectRolePageScratch(
				MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
			),
			detail: createStaticObjectRolePageScratch(
				MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
			),
			index: createStaticObjectRolePageScratch(
				MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
			),
			palette: createStaticObjectRolePageScratch(
				MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
			),
		},
	};
}

export function prepareStaticObjectDrawPayload(
	target: StaticObjectPreparedDrawPayload,
	resource: StaticObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	if (resource.materialEntries.length === 0) {
		throw new Error(
			`Static object resource ${resource.drawUnitId} has no material table entries.`,
		);
	}

	resetStaticObjectRolePageBindings(target.rolePages);
	resetStaticObjectMaterialUniforms(target.materialUniforms);
	fillStaticObjectRolePageBindings(
		target.rolePages,
		resource,
		bindings,
		textures,
	);
	fillStaticObjectMaterialUniforms(
		target.materialUniforms,
		resource,
		bindings,
		textures,
	);
}

function createStaticObjectRolePageScratch(
	slotCount: number,
): StaticObjectPreparedRolePageBindings {
	return {
		sizes: new Float32Array(slotCount * 2),
		textures: Array.from({ length: slotCount }, () => null),
	};
}

function createStaticObjectMaterialUniformScratch(): StaticObjectPreparedMaterialUniforms {
	return {
		alphaTests: new Float32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		baseColorPages: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		baseColorRects: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4,
		),
		colors: new Float32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		detailEnabled: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		detailPages: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		detailRects: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4,
		),
		detailTilings: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		),
		emissiveColors: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 3,
		),
		indexedClipThresholds: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		),
		indexedTextureFormats: new Int32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		),
		indexPages: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		indexRects: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4,
		),
		materialModes: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		paletteFirstIndices: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		),
		palettePages: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		paletteRects: new Float32Array(
			MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4,
		),
		wrapModes: new Int32Array(MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
	};
}

function resetStaticObjectRolePageBindings(
	rolePages: StaticObjectPreparedRolePageBindingsByRole,
): void {
	resetStaticObjectRolePage(rolePages.baseColor);
	resetStaticObjectRolePage(rolePages.detail);
	resetStaticObjectRolePage(rolePages.index);
	resetStaticObjectRolePage(rolePages.palette);
}

function resetStaticObjectRolePage(
	rolePage: StaticObjectPreparedRolePageBindings,
): void {
	rolePage.textures.fill(null);
	for (let slot = 0; slot < rolePage.textures.length; slot += 1) {
		rolePage.sizes[slot * 2] = 1;
		rolePage.sizes[slot * 2 + 1] = 1;
	}
}

function resetStaticObjectMaterialUniforms(
	uniforms: StaticObjectPreparedMaterialUniforms,
): void {
	uniforms.alphaTests.fill(0);
	uniforms.baseColorPages.fill(0);
	fillDefaultMaterialRectTable(uniforms.baseColorRects);
	uniforms.colors.fill(0);
	uniforms.detailEnabled.fill(0);
	uniforms.detailPages.fill(0);
	fillDefaultMaterialRectTable(uniforms.detailRects);
	uniforms.detailTilings.fill(0);
	uniforms.emissiveColors.fill(0);
	uniforms.indexedClipThresholds.fill(-1);
	uniforms.indexedTextureFormats.fill(0);
	uniforms.indexPages.fill(0);
	fillDefaultMaterialRectTable(uniforms.indexRects);
	uniforms.materialModes.fill(0);
	uniforms.paletteFirstIndices.fill(0);
	uniforms.palettePages.fill(0);
	fillDefaultMaterialRectTable(uniforms.paletteRects);
	uniforms.wrapModes.fill(0);
}

function fillDefaultMaterialRectTable(rects: Float32Array): void {
	for (
		let slot = 0;
		slot < MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW;
		slot += 1
	) {
		rects.set(DEFAULT_TEXTURE_RECT, slot * 4);
	}
}

function fillStaticObjectRolePageBindings(
	target: StaticObjectPreparedRolePageBindingsByRole,
	resource: StaticObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	for (const entry of resource.materialEntries) {
		collectStaticObjectPageBinding(
			entry.primaryTextureUseId,
			"static-base-color",
			bindings,
			textures,
			target.baseColor,
		);
		collectStaticObjectPageBinding(
			entry.indexTextureUseId,
			"static-index",
			bindings,
			textures,
			target.index,
		);
		collectStaticObjectPageBinding(
			entry.paletteTextureUseId,
			"static-palette",
			bindings,
			textures,
			target.palette,
		);
		collectStaticObjectPageBinding(
			entry.detailTextureUseId,
			"static-detail",
			bindings,
			textures,
			target.detail,
		);
	}
}

function collectStaticObjectPageBinding(
	textureUseId: string | null,
	expectedKind: TextureDrawUnitBinding["rolePage"]["kind"],
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	target: StaticObjectPreparedRolePageBindings,
): void {
	if (!textureUseId) {
		return;
	}
	const binding = bindings.get(textureUseId);
	if (!binding || binding.rolePage.kind !== expectedKind) {
		return;
	}
	const texture = textures.get(binding.textureRefId);
	const slot = binding.rolePage.slot;
	if (!texture || slot < 0 || slot >= target.textures.length) {
		return;
	}
	const existingTexture = target.textures[slot] ?? null;
	if (existingTexture && existingTexture !== texture) {
		return;
	}
	target.textures[slot] = texture;
	target.sizes[slot * 2] = binding.textureWidth;
	target.sizes[slot * 2 + 1] = binding.textureHeight;
}

function fillStaticObjectMaterialUniforms(
	target: StaticObjectPreparedMaterialUniforms,
	resource: StaticObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	const materialEntryCount = Math.min(
		resource.materialEntries.length,
		MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	);
	for (let entryIndex = 0; entryIndex < materialEntryCount; entryIndex += 1) {
		const entry = resource.materialEntries[entryIndex];
		if (!entry) {
			continue;
		}
		const slot = entry.slot;
		if (slot < 0 || slot >= MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW) {
			continue;
		}
		target.alphaTests[slot] = entry.alphaTest;
		target.colors.set(entry.materialColor, slot * 4);
		target.detailTilings[slot] = entry.detailTextureTiling;
		target.emissiveColors.set(entry.materialEmissiveColor, slot * 3);
		target.indexedTextureFormats[slot] =
			entry.indexedTextureFormat === "index16" ? 1 : 0;
		target.indexedClipThresholds[slot] = entry.indexedClipThreshold;
		target.materialModes[slot] = resolveStaticObjectMaterialEntryMode(
			resource,
			entry,
			bindings,
			textures,
		);
		target.paletteFirstIndices[slot] = entry.paletteFirstIndex;
		target.wrapModes[slot] = entry.primaryTextureWrapMode === "repeat" ? 1 : 0;

		writeStaticObjectTextureEntry(
			entry.primaryTextureUseId,
			"static-base-color",
			MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
			bindings,
			target.baseColorPages,
			target.baseColorRects,
			slot,
		);
		writeStaticObjectTextureEntry(
			entry.indexTextureUseId,
			"static-index",
			MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
			bindings,
			target.indexPages,
			target.indexRects,
			slot,
		);
		writeStaticObjectTextureEntry(
			entry.paletteTextureUseId,
			"static-palette",
			MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
			bindings,
			target.palettePages,
			target.paletteRects,
			slot,
		);
		const detailBinding = writeStaticObjectTextureEntry(
			entry.detailTextureUseId,
			"static-detail",
			MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
			bindings,
			target.detailPages,
			target.detailRects,
			slot,
		);
		target.detailEnabled[slot] =
			detailBinding && textures.has(detailBinding.textureRefId) ? 1 : 0;
	}
}

function resolveStaticObjectMaterialEntryMode(
	resource: StaticObjectMaterialPayloadResource,
	materialEntry: StaticMaterialTableEntry,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): number {
	if (resource.materialFamily === "flat-color") {
		return 0;
	}
	if (resource.materialFamily === "indexed-paletted") {
		return hasResidentBinding(
			materialEntry.indexTextureUseId,
			"static-index",
			MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
			bindings,
			textures,
		) &&
			hasResidentBinding(
				materialEntry.paletteTextureUseId,
				"static-palette",
				MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
				bindings,
				textures,
			)
			? 3
			: 2;
	}

	return hasResidentBinding(
		materialEntry.primaryTextureUseId,
		"static-base-color",
		MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
		bindings,
		textures,
	)
		? 1
		: 2;
}

function hasResidentBinding(
	textureUseId: string | null,
	expectedKind: TextureDrawUnitBinding["rolePage"]["kind"],
	maxSlots: number,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): boolean {
	if (!textureUseId) {
		return false;
	}
	const binding = bindings.get(textureUseId);

	return binding
		? binding.rolePage.kind === expectedKind &&
				binding.rolePage.slot >= 0 &&
				binding.rolePage.slot < maxSlots &&
				textures.has(binding.textureRefId)
		: false;
}

function writeStaticObjectTextureEntry(
	textureUseId: string | null,
	expectedKind: TextureDrawUnitBinding["rolePage"]["kind"],
	maxSlots: number,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	pages: Int32Array,
	rects: Float32Array,
	slot: number,
): TextureDrawUnitBinding | null {
	if (!textureUseId) {
		return null;
	}
	const binding = bindings.get(textureUseId);
	if (!binding) {
		return null;
	}
	if (
		binding.rolePage.kind !== expectedKind ||
		binding.rolePage.slot < 0 ||
		binding.rolePage.slot >= maxSlots
	) {
		return null;
	}
	pages[slot] = binding.rolePage.slot;
	rects.set(binding.rect, slot * 4);

	return binding;
}
