import type { StaticMaterialTableEntry } from "../../static/contracts";
import type { TextureBindingId } from "../../textures/identity";
import type { ResolvedTexturePlacement, TexturePageVersion } from "../types";
import { MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW } from "../types";
import type {
	RendererTextureBindingState,
	ResidentRendererTextureBinding,
} from "./webgl2-texture-bindings";

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
	/** Page version that owns the rects sampled through this binding. */
	readonly pageVersion: TexturePageVersion;
	readonly texture: WebGLTexture;
	/** Renderer texture reference resolved from the material texture binding. */
	readonly textureRefId: string;
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
	textureBindings: ObjectMaterialTextureBindingLookup,
): ObjectMaterialPreparedDrawPayload {
	if (state.isDirty) {
		prepareObjectMaterialDrawPayload(state.payload, resource, textureBindings);
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
	textureBindings: ObjectMaterialTextureBindingLookup,
): void {
	if (resource.materialEntries.length === 0) {
		throw new Error(
			`Object material resource ${resource.drawUnitId} has no material table entries.`,
		);
	}

	resetObjectMaterialTextureBindings(target.textures);
	resetObjectMaterialUniforms(target.materialUniforms);
	fillObjectMaterialTextureBindings(target.textures, resource, textureBindings);
	fillObjectMaterialUniforms(
		target.materialUniforms,
		resource,
		textureBindings,
	);
	validateObjectMaterialTextureBindings(target.textures, resource);
}

export interface ObjectMaterialTextureBindingLookup {
	getResident(
		bindingId: TextureBindingId,
	): ResidentRendererTextureBinding | null;
	getState?(bindingId: TextureBindingId): RendererTextureBindingState;
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
	textureBindings: ObjectMaterialTextureBindingLookup,
): void {
	for (const entry of resource.materialEntries) {
		collectObjectMaterialTextureBinding(
			entry.primaryTextureBindingId,
			textureBindings,
			(binding) => {
				target.baseColor = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.indexTextureBindingId,
			textureBindings,
			(binding) => {
				target.index = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.paletteTextureBindingId,
			textureBindings,
			(binding) => {
				target.palette = binding;
			},
		);
		collectObjectMaterialTextureBinding(
			entry.detailTextureBindingId,
			textureBindings,
			(binding) => {
				target.detail = binding;
			},
		);
	}
}

function collectObjectMaterialTextureBinding(
	textureBindingId: TextureBindingId | null,
	textureBindings: ObjectMaterialTextureBindingLookup,
	setBinding: (binding: ObjectMaterialTextureBinding) => void,
): void {
	if (!textureBindingId) {
		return;
	}
	const resident = textureBindings.getResident(textureBindingId);
	if (!resident) {
		return;
	}
	const { placement, texture } = resident;
	setBinding({
		height: placement.textureHeight,
		pageVersion: placement.pageVersion,
		texture,
		textureRefId: placement.textureRefId,
		width: placement.textureWidth,
	});
}

function fillObjectMaterialUniforms(
	target: ObjectMaterialPreparedUniforms,
	resource: ObjectMaterialPayloadResource,
	textureBindings: ObjectMaterialTextureBindingLookup,
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
		target.wrapModes[slot] = entry.primaryTextureWrapMode === "repeat" ? 1 : 0;

		writeObjectMaterialTextureEntry(
			entry.primaryTextureBindingId,
			textureBindings,
			target.baseColorRects,
			slot,
		);
		writeObjectMaterialTextureEntry(
			entry.indexTextureBindingId,
			textureBindings,
			target.indexRects,
			slot,
		);
		writeObjectMaterialTextureEntry(
			entry.paletteTextureBindingId,
			textureBindings,
			target.paletteRects,
			slot,
		);
		const detailPlacement = writeObjectMaterialTextureEntry(
			entry.detailTextureBindingId,
			textureBindings,
			target.detailRects,
			slot,
		);
		target.detailEnabled[slot] = detailPlacement ? 1 : 0;
	}
}

function writeObjectMaterialTextureEntry(
	textureBindingId: TextureBindingId | null,
	textureBindings: ObjectMaterialTextureBindingLookup,
	rects: Float32Array,
	slot: number,
): ResolvedTexturePlacement | null {
	if (!textureBindingId) {
		return null;
	}
	const resident = textureBindings.getResident(textureBindingId);
	if (!resident) {
		return null;
	}
	rects.set(resident.placement.rect, slot * 4);

	return resident.placement;
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
