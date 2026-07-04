import type {
	ObjectVisualRenderInstance,
	ObjectVisualResourceId,
	ObjectVisualResourceKey,
	ObjectVisualSourceGeometryKey,
} from "./object-visual-install-set";
import type { TextureBindingId } from "../textures/identity";
import type { VisualGeometryMaterialTableEntry } from "./visual-geometry";

export interface ObjectVisualResourceKeyInput {
	readonly geometry: ObjectVisualSourceGeometryKey;
	readonly indexType: ObjectVisualResourceKey["indexType"];
	readonly materialEntries: readonly VisualGeometryMaterialTableEntry[];
	readonly materialFamily: ObjectVisualResourceKey["materialFamily"];
	readonly materialPass: ObjectVisualResourceKey["materialPass"];
	readonly renderState: ObjectVisualResourceKey["renderState"];
	readonly textureUseIds: readonly TextureBindingId[];
}

export function createObjectVisualResourceKey(
	input: ObjectVisualResourceKeyInput,
): ObjectVisualResourceKey {
	return {
		geometry: input.geometry,
		indexType: input.indexType,
		kind: "static-object-visual-resource-key",
		materialEntries: input.materialEntries,
		materialFamily: input.materialFamily,
		materialPass: input.materialPass,
		renderState: input.renderState,
		textureUseIds: input.textureUseIds,
	};
}

export function createObjectVisualResourceId(
	key: ObjectVisualResourceKey,
): ObjectVisualResourceId {
	return `static-object-visual-resource:${createObjectVisualResourceKeyString(key)}`;
}

export function createObjectVisualResourceKeyString(
	key: ObjectVisualResourceKey,
): string {
	return JSON.stringify({
		geometry: createObjectVisualSourceGeometryKey(key.geometry),
		indexType: key.indexType,
		materialEntries: key.materialEntries
			.map(createObjectVisualMaterialEntryKey)
			.sort((left, right) => left.slot - right.slot),
		materialFamily: key.materialFamily,
		materialPass: key.materialPass,
		renderState: createObjectVisualRenderStateKey(key.renderState),
		textureUseIds: createUniqueSortedStrings(key.textureUseIds),
	});
}

export function groupObjectVisualRenderInstancesByResource(
	instances: readonly ObjectVisualRenderInstance[],
): ReadonlyMap<ObjectVisualResourceId, readonly ObjectVisualRenderInstance[]> {
	const grouped = new Map<
		ObjectVisualResourceId,
		ObjectVisualRenderInstance[]
	>();
	for (const instance of instances) {
		const resourceInstances = grouped.get(instance.resourceId) ?? [];
		resourceInstances.push(instance);
		grouped.set(instance.resourceId, resourceInstances);
	}

	return grouped;
}

function createObjectVisualSourceGeometryKey(
	geometry: ObjectVisualSourceGeometryKey,
) {
	return {
		gfxObj: createObjectVisualSourceKey(geometry.canonical.gfxObj),
		partIndex: geometry.canonical.partIndex,
		source: createObjectVisualSourceKey(geometry.source),
	};
}

function createObjectVisualSourceKey(
	source: ObjectVisualSourceGeometryKey["source"],
) {
	return {
		sourceAssetKind: source.sourceAssetKind,
		sourceDid: source.sourceDid,
	};
}

function createObjectVisualRenderStateKey(
	renderState: ObjectVisualResourceKey["renderState"],
) {
	return {
		blend: {
			dstFactor: renderState.blend.dstFactor,
			enabled: renderState.blend.enabled,
			mode: renderState.blend.mode,
			srcFactor: renderState.blend.srcFactor,
		},
		depthTest: renderState.depthTest,
		depthWrite: renderState.depthWrite,
	};
}

function createObjectVisualMaterialEntryKey(
	entry: VisualGeometryMaterialTableEntry,
) {
	return {
		alphaTest: entry.alphaTest,
		detailTextureTiling: entry.detailTextureTiling,
		detailTextureBindingId: entry.detailTextureBindingId,
		indexTextureBindingId: entry.indexTextureBindingId,
		indexedClipThreshold: entry.indexedClipThreshold,
		indexedTextureFormat: entry.indexedTextureFormat,
		materialColor: entry.materialColor,
		materialEmissiveColor: entry.materialEmissiveColor,
		materialIds: [...entry.materialIds].sort((left, right) => left - right),
		paletteTextureBindingId: entry.paletteTextureBindingId,
		primaryTextureBindingId: entry.primaryTextureBindingId,
		primaryTextureWrapMode: entry.primaryTextureWrapMode,
		renderState: createObjectVisualRenderStateKey(entry.renderState),
		slot: entry.slot,
	};
}

function createUniqueSortedStrings(
	values: readonly string[],
): readonly string[] {
	return Array.from(new Set(values)).sort((left, right) =>
		left.localeCompare(right),
	);
}
