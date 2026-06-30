import {
	MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW,
	MAX_OBJECT_MATERIAL_DETAIL_PAGES_PER_DRAW,
	MAX_OBJECT_MATERIAL_INDEX_PAGES_PER_DRAW,
	MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_OBJECT_MATERIAL_PALETTE_PAGES_PER_DRAW,
} from "../renderer/types";
import type {
	StaticTextureBinding,
	StaticTextureBindingOwner,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticMaterialTableEntry,
	StaticObjectSourceMappingCoverage,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalApertureResource,
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
	readonly materializedDrawUnits: readonly StaticDrawUnit[];
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
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
		textureUpdate?.textureBindings ?? [],
	);
	const removedResources = materializeRemovedStaticResources(
		input.commit.removedResources,
		input.materializedDrawUnitIdsBySourceDrawUnitId,
	);

	return {
		drawUnitIdMappings: finePartitioned.drawUnitIdMappings,
		materializedDrawUnits: finePartitioned.drawUnits,
		portalApertureResources: input.commit.addedPortalApertureResources ?? [],
		removedResources,
		staticObjectRenderInstances: input.commit.staticObjectRenderInstances,
		staticObjectVisualResources: input.commit.staticObjectVisualResources,
		...materializeStaticPeerRecords(input.commit, finePartitioned),
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
	| "staticPortalGraphs"
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
		staticPortalGraphs: commit.staticPortalGraphs,
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
	if (entries.length >= MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW) {
		return false;
	}

	const nextPages = cloneStaticRolePageSets(pages);
	addStaticObjectMaterialEntryPages(nextPages, entry, bindings);

	return (
		nextPages.baseColor.size <= MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW &&
		nextPages.detail.size <= MAX_OBJECT_MATERIAL_DETAIL_PAGES_PER_DRAW &&
		nextPages.index.size <= MAX_OBJECT_MATERIAL_INDEX_PAGES_PER_DRAW &&
		nextPages.palette.size <= MAX_OBJECT_MATERIAL_PALETTE_PAGES_PER_DRAW
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
		drawUnitId,
		materialEntries,
		materialIds: uniqueNumbers(
			materialEntries.flatMap((entry) => entry.materialIds),
		),
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
	for (const binding of textureUpdate.textureBindings) {
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
	const remappedBindings = textureUpdate.textureBindings.filter(
		(binding) =>
			binding.owner.kind !== "draw-unit" ||
			!sourceDrawUnitIds.has(binding.owner.drawUnitId),
	);

	for (const mapping of remappedStaticObjectDrawUnits) {
		for (const drawUnit of mapping.drawUnits) {
			for (const binding of createStaticObjectResourceBindings(
				{
					materialEntries: drawUnit.materialEntries,
					owner: {
						drawUnitId: drawUnit.drawUnitId,
						kind: "draw-unit",
					},
				},
				bindings,
			)) {
				remappedBindings.push(binding);
			}
		}
	}
	return {
		...textureUpdate,
		textureBindings: remappedBindings,
	};
}

function createStaticObjectResourceBindings(
	resource: {
		readonly materialEntries: readonly StaticMaterialTableEntry[];
		readonly owner: StaticTextureBindingOwner;
	},
	bindings: ReadonlyMap<string, StaticTextureBindingFacts>,
): readonly StaticTextureBinding[] {
	const roleSlots = createEmptyStaticRolePageSets();
	const textureBindings: StaticTextureBinding[] = [];
	const seenTextureUseIds = new Set<string>();

	for (const roleUse of resource.materialEntries.flatMap(
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

		textureBindings.push({
			owner: resource.owner,
			rect: binding.rect,
			rolePage,
			textureHeight: binding.textureHeight,
			textureRefId: binding.textureRefId,
			textureUseId: binding.textureUseId,
			textureWidth: binding.textureWidth,
		});
	}

	return textureBindings;
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

type StaticRolePageKind =
	| "object-base-color"
	| "object-detail"
	| "object-index"
	| "object-palette";

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
			kind: "object-base-color",
			textureUseId: entry.primaryTextureUseId,
		});
	}
	if (entry.indexTextureUseId) {
		uses.push({
			kind: "object-index",
			textureUseId: entry.indexTextureUseId,
		});
	}
	if (entry.paletteTextureUseId) {
		uses.push({
			kind: "object-palette",
			textureUseId: entry.paletteTextureUseId,
		});
	}
	if (entry.detailTextureUseId) {
		uses.push({
			kind: "object-detail",
			textureUseId: entry.detailTextureUseId,
		});
	}

	return uses;
}

function assignStaticRolePageSlot(
	pages: StaticRolePageSets,
	kind: StaticRolePageKind,
	binding: StaticTextureBindingFacts,
): StaticTextureBinding["rolePage"] | null {
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
		case "object-base-color":
			return pages.baseColor;
		case "object-detail":
			return pages.detail;
		case "object-index":
			return pages.index;
		case "object-palette":
			return pages.palette;
	}
}

function getMaxStaticRolePageSlots(kind: StaticRolePageKind): number {
	switch (kind) {
		case "object-base-color":
			return MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW;
		case "object-detail":
			return MAX_OBJECT_MATERIAL_DETAIL_PAGES_PER_DRAW;
		case "object-index":
			return MAX_OBJECT_MATERIAL_INDEX_PAGES_PER_DRAW;
		case "object-palette":
			return MAX_OBJECT_MATERIAL_PALETTE_PAGES_PER_DRAW;
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

	const materializedResources: StaticResourceKey[] = [];
	for (const resource of removedResources) {
		if (resource.kind !== "draw-unit") {
			materializedResources.push(resource);
			continue;
		}

		for (const drawUnitId of materializedDrawUnitIdsBySourceDrawUnitId.get(
			resource.drawUnitId,
		) ?? [resource.drawUnitId]) {
			materializedResources.push({ drawUnitId, kind: "draw-unit" });
		}
	}
	return materializedResources;
}

function assertTexturedDrawUnitsHaveCommittedBindings(
	drawUnits: readonly StaticDrawUnit[],
	bindings: readonly StaticTextureBinding[],
): void {
	const textureUseIdsByDrawUnitId = new Map<string, Set<string>>();
	for (const binding of bindings) {
		if (binding.owner.kind !== "draw-unit") {
			continue;
		}
		const textureUseIds =
			textureUseIdsByDrawUnitId.get(binding.owner.drawUnitId) ??
			new Set<string>();
		textureUseIds.add(binding.textureUseId);
		textureUseIdsByDrawUnitId.set(binding.owner.drawUnitId, textureUseIds);
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
