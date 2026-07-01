import type { StaticMaterialTableEntry } from "../../static/contracts";
import type { TextureBinding } from "../types";
import { MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW } from "../types";

const DEFAULT_TEXTURE_RECT = [0, 0, 1, 1] as const;

export interface ObjectMaterialPayloadResource {
	readonly drawUnitId: string;
	readonly materialFamily: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly materialEntries: readonly StaticMaterialTableEntry[];
}

export interface ObjectMaterialPreparedDrawPayload {
	readonly materialUniforms: ObjectMaterialPreparedUniforms;
	readonly textures: ObjectMaterialTextureBindingsByRole;
}

interface ObjectMaterialTextureBindingsByRole {
	baseColor: ObjectMaterialTextureBinding | null;
	detail: ObjectMaterialTextureBinding | null;
	index: ObjectMaterialTextureBinding | null;
	palette: ObjectMaterialTextureBinding | null;
}

export interface ObjectMaterialTextureBinding {
	readonly height: number;
	readonly texture: WebGLTexture;
	readonly width: number;
}

export interface ObjectMaterialPreparedUniforms {
	readonly alphaTests: Float32Array;
	readonly baseColorRects: Float32Array;
	readonly colors: Float32Array;
	readonly detailEnabled: Int32Array;
	readonly detailRects: Float32Array;
	readonly detailTilings: Float32Array;
	readonly emissiveColors: Float32Array;
	readonly indexedClipThresholds: Float32Array;
	readonly indexedTextureFormats: Int32Array;
	readonly indexRects: Float32Array;
	readonly paletteFirstIndices: Float32Array;
	readonly paletteRects: Float32Array;
	readonly wrapModes: Int32Array;
}

export interface ObjectMaterialPreparedDrawPayloadState {
	readonly payload: ObjectMaterialPreparedDrawPayload;
	isDirty: boolean;
}

export function createObjectMaterialPreparedDrawPayloadState(): ObjectMaterialPreparedDrawPayloadState {
	return {
		isDirty: true,
		payload: createObjectMaterialPreparedDrawPayload(),
	};
}

export function markObjectMaterialPreparedDrawPayloadDirty(
	state: ObjectMaterialPreparedDrawPayloadState,
): void {
	state.isDirty = true;
}

export function prepareObjectMaterialDrawPayloadState(
	state: ObjectMaterialPreparedDrawPayloadState,
	resource: ObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): ObjectMaterialPreparedDrawPayload {
	if (state.isDirty) {
		prepareObjectMaterialDrawPayload(
			state.payload,
			resource,
			bindings,
			textures,
		);
		state.isDirty = false;
	}

	return state.payload;
}

export function createObjectMaterialPreparedDrawPayload(): ObjectMaterialPreparedDrawPayload {
	return {
		materialUniforms: createObjectMaterialUniformScratch(),
		textures: {
			baseColor: null,
			detail: null,
			index: null,
			palette: null,
		},
	};
}

export function prepareObjectMaterialDrawPayload(
	target: ObjectMaterialPreparedDrawPayload,
	resource: ObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	if (resource.materialEntries.length === 0) {
		throw new Error(
			`Object material resource ${resource.drawUnitId} has no material table entries.`,
		);
	}

	resetObjectMaterialTextureBindings(target.textures);
	resetObjectMaterialUniforms(target.materialUniforms);
	fillObjectMaterialTextureBindings(
		target.textures,
		resource,
		bindings,
		textures,
	);
	fillObjectMaterialUniforms(
		target.materialUniforms,
		resource,
		bindings,
		textures,
	);
	validateObjectMaterialTextureBindings(target.textures, resource);
}

function createObjectMaterialUniformScratch(): ObjectMaterialPreparedUniforms {
	return {
		alphaTests: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		baseColorRects: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		colors: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		detailEnabled: new Int32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		detailRects: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		detailTilings: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		emissiveColors: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 3),
		indexedClipThresholds: new Float32Array(
			MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		),
		indexedTextureFormats: new Int32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		indexRects: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		paletteFirstIndices: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
		paletteRects: new Float32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW * 4),
		wrapModes: new Int32Array(MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW),
	};
}

function resetObjectMaterialTextureBindings(
	textures: ObjectMaterialTextureBindingsByRole,
): void {
	textures.baseColor = null;
	textures.detail = null;
	textures.index = null;
	textures.palette = null;
}

function resetObjectMaterialUniforms(
	uniforms: ObjectMaterialPreparedUniforms,
): void {
	uniforms.alphaTests.fill(0);
	fillDefaultMaterialRectTable(uniforms.baseColorRects);
	uniforms.colors.fill(0);
	uniforms.detailEnabled.fill(0);
	fillDefaultMaterialRectTable(uniforms.detailRects);
	uniforms.detailTilings.fill(0);
	uniforms.emissiveColors.fill(0);
	uniforms.indexedClipThresholds.fill(-1);
	uniforms.indexedTextureFormats.fill(0);
	fillDefaultMaterialRectTable(uniforms.indexRects);
	uniforms.paletteFirstIndices.fill(0);
	fillDefaultMaterialRectTable(uniforms.paletteRects);
	uniforms.wrapModes.fill(0);
}

function fillDefaultMaterialRectTable(rects: Float32Array): void {
	for (let slot = 0; slot < MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW; slot += 1) {
		rects.set(DEFAULT_TEXTURE_RECT, slot * 4);
	}
}

function fillObjectMaterialTextureBindings(
	target: ObjectMaterialTextureBindingsByRole,
	resource: ObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	for (const entry of resource.materialEntries) {
		collectObjectMaterialTextureBinding(
			entry.primaryTextureUseId,
			"object-base-color",
			bindings,
			textures,
			(binding) => {
				target.baseColor = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.indexTextureUseId,
			"object-index",
			bindings,
			textures,
			(binding) => {
				target.index = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.paletteTextureUseId,
			"object-palette",
			bindings,
			textures,
			(binding) => {
				target.palette = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.detailTextureUseId,
			"object-detail",
			bindings,
			textures,
			(binding) => {
				target.detail = binding;
			},
		);
	}
}

function collectObjectMaterialTextureBinding(
	textureUseId: string | null,
	expectedKind: TextureBinding["pageSlot"]["kind"],
	bindings: ReadonlyMap<string, TextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	setBinding: (binding: ObjectMaterialTextureBinding) => void,
): void {
	if (!textureUseId) {
		return;
	}
	const binding = bindings.get(textureUseId);
	if (!binding || binding.pageSlot.kind !== expectedKind) {
		return;
	}
	const texture = textures.get(binding.textureRefId);
	if (!texture || binding.pageSlot.slot !== 0) {
		return;
	}
	setBinding({
		height: binding.textureHeight,
		texture,
		width: binding.textureWidth,
	});
}

function fillObjectMaterialUniforms(
	target: ObjectMaterialPreparedUniforms,
	resource: ObjectMaterialPayloadResource,
	bindings: ReadonlyMap<string, TextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
): void {
	const materialEntryCount = Math.min(
		resource.materialEntries.length,
		MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	);
	for (let entryIndex = 0; entryIndex < materialEntryCount; entryIndex += 1) {
		const entry = resource.materialEntries[entryIndex];
		if (!entry) {
			continue;
		}
		const slot = entry.slot;
		if (slot < 0 || slot >= MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW) {
			continue;
		}
		target.alphaTests[slot] = entry.alphaTest;
		target.colors.set(entry.materialColor, slot * 4);
		target.detailTilings[slot] = entry.detailTextureTiling;
		target.emissiveColors.set(entry.materialEmissiveColor, slot * 3);
		target.indexedTextureFormats[slot] =
			entry.indexedTextureFormat === "index16" ? 1 : 0;
		target.indexedClipThresholds[slot] = entry.indexedClipThreshold;
		target.paletteFirstIndices[slot] = entry.paletteFirstIndex;
		target.wrapModes[slot] = entry.primaryTextureWrapMode === "repeat" ? 1 : 0;

		writeObjectMaterialTextureEntry(
			entry.primaryTextureUseId,
			"object-base-color",
			bindings,
			target.baseColorRects,
			slot,
		);
		writeObjectMaterialTextureEntry(
			entry.indexTextureUseId,
			"object-index",
			bindings,
			target.indexRects,
			slot,
		);
		writeObjectMaterialTextureEntry(
			entry.paletteTextureUseId,
			"object-palette",
			bindings,
			target.paletteRects,
			slot,
		);
		const detailBinding = writeObjectMaterialTextureEntry(
			entry.detailTextureUseId,
			"object-detail",
			bindings,
			target.detailRects,
			slot,
		);
		target.detailEnabled[slot] =
			detailBinding && textures.has(detailBinding.textureRefId) ? 1 : 0;
	}
}

function writeObjectMaterialTextureEntry(
	textureUseId: string | null,
	expectedKind: TextureBinding["pageSlot"]["kind"],
	bindings: ReadonlyMap<string, TextureBinding>,
	rects: Float32Array,
	slot: number,
): TextureBinding | null {
	if (!textureUseId) {
		return null;
	}
	const binding = bindings.get(textureUseId);
	if (!binding) {
		return null;
	}
	if (binding.pageSlot.kind !== expectedKind || binding.pageSlot.slot !== 0) {
		return null;
	}
	rects.set(binding.rect, slot * 4);

	return binding;
}

function validateObjectMaterialTextureBindings(
	textures: ObjectMaterialTextureBindingsByRole,
	resource: ObjectMaterialPayloadResource,
): void {
	if (resource.materialFamily === "texture-rgba" && !textures.baseColor) {
		throw new Error(
			`Object material resource ${resource.drawUnitId} is missing resident base-color texture binding.`,
		);
	}
	if (resource.materialFamily === "indexed-paletted") {
		if (!textures.index) {
			throw new Error(
				`Object material resource ${resource.drawUnitId} is missing resident index texture binding.`,
			);
		}
		if (!textures.palette) {
			throw new Error(
				`Object material resource ${resource.drawUnitId} is missing resident palette texture binding.`,
			);
		}
	}
}
