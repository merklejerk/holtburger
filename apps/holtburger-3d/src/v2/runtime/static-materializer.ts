import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
} from "../renderer/types";
import { collectStaticDrawUnitResourceIds } from "../static/contracts";
import type {
	StaticResidencyDelta,
	TextureDrawUnitBinding,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticMaterialTableEntry,
	StaticObjectSourceMappingCoverage,
	StaticAuthoredDynamicSeedRecord,
	StaticPortalInteriorRecord,
	StaticResourceKey,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
} from "../static/contracts";

export interface StaticMaterializationInput {
	readonly commit: StaticCoordinatorCommitDelta;
	readonly materializedDrawUnitIdsBySourceDrawUnitId?: ReadonlyMap<
		string,
		readonly string[]
	>;
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export interface StaticMaterializationResult {
	readonly drawUnitIdMappings: readonly StaticMaterializedDrawUnitIdMapping[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticDelta: StaticResidencyDelta;
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly textureUpdate: TexturePlacementUpdate | null;
}

interface StaticMaterializedDrawUnitIdMapping {
	readonly materializedDrawUnitIds: readonly string[];
	readonly sourceDrawUnitId: string;
}

export function materializeStaticCommit(
	input: StaticMaterializationInput,
): StaticMaterializationResult {
	const finePartitioned = finePartitionStaticDrawUnits(
		input.commit.addedDrawUnits,
		input.textureUpdate,
	);
	const textureUpdate = materializeTextureUpdate(
		input.textureUpdate,
		finePartitioned.remappedStaticObjectDrawUnits,
	);

	assertTexturedDrawUnitsHaveCommittedBindings(
		finePartitioned.drawUnits,
		textureUpdate?.drawUnitBindings ?? [],
	);
	const removedResources = materializeRemovedStaticResources(
		input.commit.removedResources,
		input.materializedDrawUnitIdsBySourceDrawUnitId,
	);

	return {
		drawUnitIdMappings: finePartitioned.drawUnitIdMappings,
		removedResources,
		...materializeStaticPeerRecords(input.commit, finePartitioned),
		staticDelta: {
			addedDrawUnits: finePartitioned.drawUnits,
			removedDrawUnitIds: collectStaticDrawUnitResourceIds(removedResources),
			revision: input.commit.revision,
		},
		textureUpdate,
	};
}

function finePartitionStaticDrawUnits(
	drawUnits: readonly StaticDrawUnit[],
	textureUpdate: TexturePlacementUpdate | null,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly drawUnitIdMappings: readonly StaticMaterializedDrawUnitIdMapping[];
	readonly remappedStaticObjectDrawUnits: readonly RemappedStaticObjectDrawUnit[];
} {
	const bindings = createTextureBindingFactsByTextureUseId(textureUpdate);
	const materializedDrawUnits: StaticDrawUnit[] = [];
	const mappings: StaticMaterializedDrawUnitIdMapping[] = [];
	const remappedStaticObjectDrawUnits: RemappedStaticObjectDrawUnit[] = [];

	for (const drawUnit of drawUnits) {
		if (drawUnit.kind !== "static-object-geometry") {
			materializedDrawUnits.push(drawUnit);
			mappings.push({
				materializedDrawUnitIds: [drawUnit.drawUnitId],
				sourceDrawUnitId: drawUnit.drawUnitId,
			});
			continue;
		}

		const splitDrawUnits = splitStaticObjectDrawUnit(drawUnit, bindings);
		materializedDrawUnits.push(...splitDrawUnits);
		remappedStaticObjectDrawUnits.push({
			drawUnits: splitDrawUnits,
			sourceDrawUnitId: drawUnit.drawUnitId,
		});
		mappings.push({
			materializedDrawUnitIds: splitDrawUnits.map((split) => split.drawUnitId),
			sourceDrawUnitId: drawUnit.drawUnitId,
		});
	}

	return {
		drawUnitIdMappings: mappings,
		drawUnits: materializedDrawUnits,
		remappedStaticObjectDrawUnits,
	};
}

interface RemappedStaticObjectDrawUnit {
	readonly drawUnits: readonly StaticObjectGeometryStaticDrawUnit[];
	readonly sourceDrawUnitId: string;
}

function materializeStaticPeerRecords(
	commit: StaticCoordinatorCommitDelta,
	finePartitioned: {
		readonly remappedStaticObjectDrawUnits: readonly RemappedStaticObjectDrawUnit[];
	},
): Pick<
	StaticMaterializationResult,
	| "staticAuthoredDynamicSeeds"
	| "staticPortalInteriorRecords"
	| "staticSourceMappings"
	| "staticSpatialRecords"
	| "staticVisibilityRecords"
> {
	const remappedSourceDrawUnitIds = new Set(
		finePartitioned.remappedStaticObjectDrawUnits.map(
			(mapping) => mapping.sourceDrawUnitId,
		),
	);
	const staticObjectDrawUnits =
		finePartitioned.remappedStaticObjectDrawUnits.flatMap(
			(mapping) => mapping.drawUnits,
		);

	return {
		staticAuthoredDynamicSeeds: commit.staticAuthoredDynamicSeeds,
		staticPortalInteriorRecords: commit.staticPortalInteriorRecords,
		staticSourceMappings: [
			...commit.staticSourceMappings.filter(
				(record) => !isOwnedByAnyDrawUnit(record, remappedSourceDrawUnitIds),
			),
		],
		staticSpatialRecords: [
			...commit.staticSpatialRecords.filter(
				(record) => !isOwnedByAnyDrawUnit(record, remappedSourceDrawUnitIds),
			),
			...staticObjectDrawUnits.flatMap((drawUnit) =>
				drawUnit.spatialRecord ? [drawUnit.spatialRecord] : [],
			),
		],
		staticVisibilityRecords: commit.staticVisibilityRecords,
	};
}

function isOwnedByAnyDrawUnit(
	record: {
		readonly owner: { readonly kind: string; readonly drawUnitId?: string };
	},
	drawUnitIds: ReadonlySet<string>,
): boolean {
	return (
		record.owner.kind === "draw-unit" &&
		typeof record.owner.drawUnitId === "string" &&
		drawUnitIds.has(record.owner.drawUnitId)
	);
}

function splitStaticObjectDrawUnit(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): readonly StaticObjectGeometryStaticDrawUnit[] {
	const slices = createStaticObjectMaterialSlices(
		drawUnit.materialEntries,
		bindings,
	);
	if (slices.length === 1) {
		return [remapStaticObjectDrawUnit(drawUnit, slices[0]!, 0)];
	}

	return slices.map((slice, index) =>
		remapStaticObjectDrawUnit(drawUnit, slice, index),
	);
}

function createStaticObjectMaterialSlices(
	entries: readonly StaticMaterialTableEntry[],
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): readonly StaticMaterialTableEntry[][] {
	if (entries.length === 0) {
		return [[]];
	}

	const slices: StaticMaterialTableEntry[][] = [];
	let currentEntries: StaticMaterialTableEntry[] = [];
	let currentPages = createEmptyStaticRolePageSets();

	for (const entry of entries) {
		if (
			currentEntries.length > 0 &&
			!canAddStaticObjectMaterialEntry(
				currentEntries,
				currentPages,
				entry,
				bindings,
			)
		) {
			slices.push(currentEntries);
			currentEntries = [];
			currentPages = createEmptyStaticRolePageSets();
		}

		currentEntries.push(entry);
		addStaticObjectMaterialEntryPages(currentPages, entry, bindings);
	}

	if (currentEntries.length > 0) {
		slices.push(currentEntries);
	}

	return slices;
}

function canAddStaticObjectMaterialEntry(
	entries: readonly StaticMaterialTableEntry[],
	pages: StaticRolePageSets,
	entry: StaticMaterialTableEntry,
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): boolean {
	if (entries.length >= MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW) {
		return false;
	}

	const nextPages = cloneStaticRolePageSets(pages);
	addStaticObjectMaterialEntryPages(nextPages, entry, bindings);

	return (
		nextPages.baseColor.size <= MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW &&
		nextPages.detail.size <= MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW &&
		nextPages.index.size <= MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW &&
		nextPages.palette.size <= MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW
	);
}

function addStaticObjectMaterialEntryPages(
	pages: StaticRolePageSets,
	entry: StaticMaterialTableEntry,
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): void {
	addStaticRolePage(pages.baseColor, entry.primaryTextureUseId, bindings);
	addStaticRolePage(pages.detail, entry.detailTextureUseId, bindings);
	addStaticRolePage(pages.index, entry.indexTextureUseId, bindings);
	addStaticRolePage(pages.palette, entry.paletteTextureUseId, bindings);
}

function addStaticRolePage(
	pages: Set<string>,
	textureUseId: string | null,
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): void {
	if (!textureUseId) {
		return;
	}

	const binding = bindings.get(textureUseId);
	if (!binding) {
		pages.add(`missing:${textureUseId}`);
		return;
	}

	pages.add(binding.textureRefId);
}

interface StaticRolePageSets {
	readonly baseColor: Set<string>;
	readonly detail: Set<string>;
	readonly index: Set<string>;
	readonly palette: Set<string>;
}

function createEmptyStaticRolePageSets(): StaticRolePageSets {
	return {
		baseColor: new Set(),
		detail: new Set(),
		index: new Set(),
		palette: new Set(),
	};
}

function cloneStaticRolePageSets(
	pages: StaticRolePageSets,
): StaticRolePageSets {
	return {
		baseColor: new Set(pages.baseColor),
		detail: new Set(pages.detail),
		index: new Set(pages.index),
		palette: new Set(pages.palette),
	};
}

function remapStaticObjectDrawUnit(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
	entries: readonly StaticMaterialTableEntry[],
	sliceIndex: number,
): StaticObjectGeometryStaticDrawUnit {
	const slotBySourceSlot = new Map<number, number>();
	const materialEntries = entries.map((entry, index) => {
		slotBySourceSlot.set(entry.slot, index);
		return { ...entry, slot: index };
	});
	const geometry = copyStaticObjectGeometryForMaterialSlots(
		drawUnit,
		slotBySourceSlot,
	);
	const drawUnitId = createFineStaticDrawUnitId(
		drawUnit.drawUnitId,
		sliceIndex,
	);
	const summary = materialEntries[0] ?? drawUnit.materialEntries[0];
	const textureUseIds = uniqueSortedStrings(
		materialEntries.flatMap((entry) =>
			[
				entry.primaryTextureUseId,
				entry.indexTextureUseId,
				entry.paletteTextureUseId,
				entry.detailTextureUseId,
			].filter((textureUseId): textureUseId is string => textureUseId !== null),
		),
	);

	return {
		...drawUnit,
		...geometry,
		alphaTest: summary?.alphaTest ?? drawUnit.alphaTest,
		detailTextureTiling:
			summary?.detailTextureTiling ?? drawUnit.detailTextureTiling,
		detailTextureUseId:
			summary?.detailTextureUseId ?? drawUnit.detailTextureUseId,
		drawUnitId,
		indexTextureUseId: summary?.indexTextureUseId ?? drawUnit.indexTextureUseId,
		indexedClipThreshold:
			summary?.indexedClipThreshold ?? drawUnit.indexedClipThreshold,
		indexedTextureFormat:
			summary?.indexedTextureFormat ?? drawUnit.indexedTextureFormat,
		materialColor: summary?.materialColor ?? drawUnit.materialColor,
		materialEmissiveColor:
			summary?.materialEmissiveColor ?? drawUnit.materialEmissiveColor,
		materialEntries,
		materialIds: uniqueNumbers(
			materialEntries.flatMap((entry) => entry.materialIds),
		),
		renderState: summary?.renderState ?? drawUnit.renderState,
		paletteFirstIndex: summary?.paletteFirstIndex ?? drawUnit.paletteFirstIndex,
		paletteTextureUseId:
			summary?.paletteTextureUseId ?? drawUnit.paletteTextureUseId,
		primaryTextureUseId:
			summary?.primaryTextureUseId ?? drawUnit.primaryTextureUseId,
		primaryTextureWrapMode:
			summary?.primaryTextureWrapMode ?? drawUnit.primaryTextureWrapMode,
		sourceMappingCoverage: geometry.sourceMappingCoverage,
		spatialRecord: createDrawUnitSpatialRecord(
			drawUnitId,
			geometry.triangleCount,
		),
		textureUseIds,
	};
}

function createDrawUnitSpatialRecord(
	drawUnitId: string,
	triangleCount: number,
): StaticSpatialRecord {
	return {
		drawUnitId,
		kind: "draw-unit-bounds",
		owner: {
			drawUnitId,
			kind: "draw-unit",
		},
		triangleCount,
	};
}

function copyStaticObjectGeometryForMaterialSlots(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
	slotBySourceSlot: ReadonlyMap<number, number>,
): Pick<
	StaticObjectGeometryStaticDrawUnit,
	| "indices"
	| "indexType"
	| "materialSlotIndices"
	| "positions"
	| "sourceMappingCoverage"
	| "texCoords"
	| "triangleCount"
	| "vertexCount"
> {
	const positions: number[] = [];
	const texCoords: number[] = [];
	const materialSlotIndices: number[] = [];
	const indices: number[] = [];
	const retainedSourceSlots = new Set<number>();
	let triangleCount = 0;

	for (
		let indexOffset = 0;
		indexOffset < drawUnit.indices.length;
		indexOffset += 3
	) {
		const sourceVertexIndex = drawUnit.indices[indexOffset]!;
		const sourceSlot = drawUnit.materialSlotIndices[sourceVertexIndex];
		if (sourceSlot === undefined) {
			continue;
		}
		const targetSlot = slotBySourceSlot.get(sourceSlot);
		if (targetSlot === undefined) {
			continue;
		}

		retainedSourceSlots.add(sourceSlot);
		triangleCount += 1;

		for (let corner = 0; corner < 3; corner += 1) {
			const sourceIndex = drawUnit.indices[indexOffset + corner]!;
			const targetIndex = indices.length;
			indices.push(targetIndex);
			positions.push(
				drawUnit.positions[sourceIndex * 3] ?? 0,
				drawUnit.positions[sourceIndex * 3 + 1] ?? 0,
				drawUnit.positions[sourceIndex * 3 + 2] ?? 0,
			);
			texCoords.push(
				drawUnit.texCoords[sourceIndex * 2] ?? 0,
				drawUnit.texCoords[sourceIndex * 2 + 1] ?? 0,
			);
			materialSlotIndices.push(targetSlot);
		}
	}

	const vertexCount = positions.length / 3;
	const indexType = vertexCount > 65535 ? "uint32" : "uint16";

	return {
		indices:
			indexType === "uint16"
				? new Uint16Array(indices)
				: new Uint32Array(indices),
		indexType,
		materialSlotIndices: new Float32Array(materialSlotIndices),
		positions: new Float32Array(positions),
		sourceMappingCoverage: drawUnit.sourceMappingCoverage
			.filter((coverage) => retainedSourceSlots.has(coverage.materialSlot))
			.map((coverage) =>
				remapSourceMappingCoverage(coverage, slotBySourceSlot),
			),
		texCoords: new Float32Array(texCoords),
		triangleCount,
		vertexCount,
	};
}

function remapSourceMappingCoverage(
	coverage: StaticObjectSourceMappingCoverage,
	slotBySourceSlot: ReadonlyMap<number, number>,
): StaticObjectSourceMappingCoverage {
	const materialSlot = slotBySourceSlot.get(coverage.materialSlot);
	if (materialSlot === undefined) {
		throw new Error(
			`Static object source mapping coverage references missing material slot ${coverage.materialSlot}.`,
		);
	}

	return {
		...coverage,
		materialSlot,
	};
}

function createFineStaticDrawUnitId(
	drawUnitId: string,
	sliceIndex: number,
): string {
	return sliceIndex === 0 ? drawUnitId : `${drawUnitId}#fine-${sliceIndex}`;
}

interface StaticTextureBindingFacts {
	readonly rect: readonly [number, number, number, number];
	readonly textureHeight: number;
	readonly textureRefId: string;
	readonly textureUseId: string;
	readonly textureWidth: number;
}

function createTextureBindingFactsByTextureUseId(
	textureUpdate: TexturePlacementUpdate | null,
): ReadonlyMap<string, StaticTextureBindingFacts> {
	const bindings = new Map<string, StaticTextureBindingFacts>();
	if (!textureUpdate) {
		return bindings;
	}

	for (const placement of textureUpdate.placements) {
		bindings.set(placement.textureUseId, {
			rect: placement.rect,
			textureHeight: placement.height,
			textureRefId: placement.textureRefId,
			textureUseId: placement.textureUseId,
			textureWidth: placement.width,
		});
	}
	for (const placement of textureUpdate.textureUsePlacements) {
		bindings.set(placement.textureUseId, {
			rect: placement.rect,
			textureHeight: placement.textureHeight,
			textureRefId: placement.textureRefId,
			textureUseId: placement.textureUseId,
			textureWidth: placement.textureWidth,
		});
	}
	for (const binding of textureUpdate.drawUnitBindings) {
		bindings.set(binding.textureUseId, {
			rect: binding.rect,
			textureHeight: binding.textureHeight,
			textureRefId: binding.textureRefId,
			textureUseId: binding.textureUseId,
			textureWidth: binding.textureWidth,
		});
	}

	return bindings;
}

function materializeTextureUpdate(
	textureUpdate: TexturePlacementUpdate | null,
	remappedStaticObjectDrawUnits: readonly RemappedStaticObjectDrawUnit[],
): TexturePlacementUpdate | null {
	if (!textureUpdate) {
		return null;
	}

	if (remappedStaticObjectDrawUnits.length === 0) {
		return textureUpdate;
	}

	const sourceDrawUnitIds = new Set(
		remappedStaticObjectDrawUnits.map((mapping) => mapping.sourceDrawUnitId),
	);
	const bindings = createTextureBindingFactsByTextureUseId(textureUpdate);
	const remappedBindings = textureUpdate.drawUnitBindings.filter(
		(binding) => !sourceDrawUnitIds.has(binding.drawUnitId),
	);

	for (const mapping of remappedStaticObjectDrawUnits) {
		for (const drawUnit of mapping.drawUnits) {
			for (const binding of createStaticObjectDrawUnitBindings(
				drawUnit,
				bindings,
			)) {
				remappedBindings.push(binding);
			}
		}
	}

	return {
		...textureUpdate,
		drawUnitBindings: remappedBindings,
	};
}

function createStaticObjectDrawUnitBindings(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): readonly TextureDrawUnitBinding[] {
	const roleSlots = createEmptyStaticRolePageSets();
	const drawUnitBindings: TextureDrawUnitBinding[] = [];
	const seenTextureUseIds = new Set<string>();

	for (const roleUse of drawUnit.materialEntries.flatMap(
		createStaticRoleTextureUses,
	)) {
		if (seenTextureUseIds.has(roleUse.textureUseId)) {
			continue;
		}
		seenTextureUseIds.add(roleUse.textureUseId);

		const binding = bindings.get(roleUse.textureUseId);
		if (!binding) {
			continue;
		}
		const rolePage = assignStaticRolePageSlot(roleSlots, roleUse.kind, binding);
		if (!rolePage) {
			continue;
		}

		drawUnitBindings.push({
			drawUnitId: drawUnit.drawUnitId,
			rect: binding.rect,
			rolePage,
			textureHeight: binding.textureHeight,
			textureRefId: binding.textureRefId,
			textureUseId: binding.textureUseId,
			textureWidth: binding.textureWidth,
		});
	}

	return drawUnitBindings;
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

type StaticRolePageKind =
	| "static-base-color"
	| "static-detail"
	| "static-index"
	| "static-palette";

interface StaticRoleTextureUse {
	readonly kind: StaticRolePageKind;
	readonly textureUseId: string;
}

function createStaticRoleTextureUses(
	entry: StaticMaterialTableEntry,
): readonly StaticRoleTextureUse[] {
	const uses: StaticRoleTextureUse[] = [];
	if (entry.primaryTextureUseId) {
		uses.push({
			kind: "static-base-color",
			textureUseId: entry.primaryTextureUseId,
		});
	}
	if (entry.indexTextureUseId) {
		uses.push({
			kind: "static-index",
			textureUseId: entry.indexTextureUseId,
		});
	}
	if (entry.paletteTextureUseId) {
		uses.push({
			kind: "static-palette",
			textureUseId: entry.paletteTextureUseId,
		});
	}
	if (entry.detailTextureUseId) {
		uses.push({
			kind: "static-detail",
			textureUseId: entry.detailTextureUseId,
		});
	}

	return uses;
}

function assignStaticRolePageSlot(
	pages: StaticRolePageSets,
	kind: StaticRolePageKind,
	binding: StaticTextureBindingFacts,
): TextureDrawUnitBinding["rolePage"] | null {
	const rolePages = getStaticRolePageSet(pages, kind);
	const existingSlot = [...rolePages].indexOf(binding.textureRefId);
	if (existingSlot >= 0) {
		return { kind, slot: existingSlot };
	}

	const maxSlots = getMaxStaticRolePageSlots(kind);
	if (rolePages.size >= maxSlots) {
		return null;
	}

	rolePages.add(binding.textureRefId);
	return { kind, slot: rolePages.size - 1 };
}

function getStaticRolePageSet(
	pages: StaticRolePageSets,
	kind: StaticRolePageKind,
): Set<string> {
	switch (kind) {
		case "static-base-color":
			return pages.baseColor;
		case "static-detail":
			return pages.detail;
		case "static-index":
			return pages.index;
		case "static-palette":
			return pages.palette;
	}
}

function getMaxStaticRolePageSlots(kind: StaticRolePageKind): number {
	switch (kind) {
		case "static-base-color":
			return MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW;
		case "static-detail":
			return MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW;
		case "static-index":
			return MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW;
		case "static-palette":
			return MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW;
	}
}

function materializeRemovedStaticResources(
	removedResources: readonly StaticResourceKey[],
	materializedDrawUnitIdsBySourceDrawUnitId:
		| ReadonlyMap<string, readonly string[]>
		| undefined,
): readonly StaticResourceKey[] {
	if (!materializedDrawUnitIdsBySourceDrawUnitId) {
		return removedResources;
	}

	return removedResources.flatMap((resource) =>
		resource.kind === "draw-unit"
			? (
					materializedDrawUnitIdsBySourceDrawUnitId.get(
						resource.drawUnitId,
					) ?? [resource.drawUnitId]
				).map((drawUnitId) => ({ drawUnitId, kind: "draw-unit" as const }))
			: [resource],
	);
}

function assertTexturedDrawUnitsHaveCommittedBindings(
	drawUnits: readonly StaticDrawUnit[],
	bindings: readonly TextureDrawUnitBinding[],
): void {
	const textureUseIdsByDrawUnitId = new Map<string, Set<string>>();
	for (const binding of bindings) {
		const textureUseIds =
			textureUseIdsByDrawUnitId.get(binding.drawUnitId) ?? new Set<string>();
		textureUseIds.add(binding.textureUseId);
		textureUseIdsByDrawUnitId.set(binding.drawUnitId, textureUseIds);
	}

	for (const drawUnit of drawUnits) {
		const expectedTextureUseIds = getStaticDrawUnitTextureUseIds(drawUnit);
		if (expectedTextureUseIds.length === 0) {
			continue;
		}

		const committedTextureUseIds =
			textureUseIdsByDrawUnitId.get(drawUnit.drawUnitId) ?? new Set<string>();
		const missingTextureUseIds = expectedTextureUseIds.filter(
			(textureUseId) => !committedTextureUseIds.has(textureUseId),
		);
		if (missingTextureUseIds.length > 0) {
			throw new Error(
				`Static draw unit ${drawUnit.drawUnitId} is missing committed texture bindings for ${missingTextureUseIds.join(", ")}.`,
			);
		}
	}
}

function getStaticDrawUnitTextureUseIds(
	drawUnit: StaticDrawUnit,
): readonly string[] {
	return drawUnit.textureUseIds;
}
