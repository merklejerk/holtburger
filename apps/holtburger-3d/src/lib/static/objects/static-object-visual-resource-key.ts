import type {
	StaticMaterialTableEntry,
	StaticObjectRenderInstance,
	StaticObjectRenderState,
	StaticObjectSourceGeometryIdentity,
	StaticObjectVisualResourceId,
	StaticObjectVisualResourceKey,
	StaticObjectGeometryStaticDrawUnit,
} from "../contracts";

export interface StaticObjectVisualResourceKeyInput {
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly renderState: StaticObjectRenderState;
	readonly indexType: StaticObjectGeometryStaticDrawUnit["indexType"];
	readonly textureUseIds: readonly string[];
}

export function createStaticObjectVisualResourceKey(
	input: StaticObjectVisualResourceKeyInput,
): StaticObjectVisualResourceKey {
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

export function createStaticObjectVisualResourceId(
	key: StaticObjectVisualResourceKey,
): StaticObjectVisualResourceId {
	return `static-object-visual-resource:${createStaticObjectVisualResourceKeyString(key)}`;
}

export function createStaticObjectVisualResourceKeyString(
	key: StaticObjectVisualResourceKey,
): string {
	return JSON.stringify({
		geometry: createStaticObjectSourceGeometryKey(key.geometry),
		indexType: key.indexType,
		materialEntries: key.materialEntries
			.map(createStaticObjectMaterialEntryKey)
			.sort((left, right) => left.slot - right.slot),
		materialFamily: key.materialFamily,
		materialPass: key.materialPass,
		renderState: createStaticObjectRenderStateKey(key.renderState),
		textureUseIds: createUniqueSortedStrings(key.textureUseIds),
	});
}

export function groupStaticObjectRenderInstancesByVisualResource(
	instances: readonly StaticObjectRenderInstance[],
): ReadonlyMap<StaticObjectVisualResourceId, readonly StaticObjectRenderInstance[]> {
	const grouped = new Map<
		StaticObjectVisualResourceId,
		StaticObjectRenderInstance[]
	>();
	for (const instance of instances) {
		const resourceInstances = grouped.get(instance.resourceId) ?? [];
		resourceInstances.push(instance);
		grouped.set(instance.resourceId, resourceInstances);
	}

	return grouped;
}

function createStaticObjectSourceGeometryKey(
	geometry: StaticObjectSourceGeometryIdentity,
) {
	return {
		gfxObj: createStaticObjectSourceKey(geometry.gfxObj),
		partIndex: geometry.partIndex,
		source: createStaticObjectSourceKey(geometry.source),
	};
}

function createStaticObjectSourceKey(
	source: StaticObjectSourceGeometryIdentity["source"],
) {
	return {
		sourceAssetKind: source.sourceAssetKind,
		sourceDid: source.sourceDid,
	};
}

function createStaticObjectRenderStateKey(renderState: StaticObjectRenderState) {
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

function createStaticObjectMaterialEntryKey(entry: StaticMaterialTableEntry) {
	return {
		alphaTest: entry.alphaTest,
		detailTextureTiling: entry.detailTextureTiling,
		detailTextureUseId: entry.detailTextureUseId,
		indexTextureUseId: entry.indexTextureUseId,
		indexedClipThreshold: entry.indexedClipThreshold,
		indexedTextureFormat: entry.indexedTextureFormat,
		materialColor: entry.materialColor,
		materialEmissiveColor: entry.materialEmissiveColor,
		materialIds: [...entry.materialIds].sort((left, right) => left - right),
		paletteFirstIndex: entry.paletteFirstIndex,
		paletteTextureUseId: entry.paletteTextureUseId,
		primaryTextureUseId: entry.primaryTextureUseId,
		primaryTextureWrapMode: entry.primaryTextureWrapMode,
		renderState: createStaticObjectRenderStateKey(entry.renderState),
		slot: entry.slot,
	};
}

function createUniqueSortedStrings(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort((left, right) =>
		left.localeCompare(right),
	);
}
