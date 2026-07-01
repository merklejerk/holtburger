import {
	writeTexCoord,
	writeTransformedPosition,
} from "../math/ac-placement-transform";
import type { TextureResourceDependencies } from "../textures/placement";
import { MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW } from "../renderer/types";
import type {
	DynamicAnimationPartBinding,
	ObjectVisualGeometryBuffer,
	ObjectVisualGeometryBufferId,
	ObjectVisualMaterialRecipe,
	ObjectVisualMaterialRecipeId,
	ObjectVisualRecipeBundle,
	ObjectVisualTextureRecipeId,
} from "./object-visual-recipe-bundle";
import type {
	VisualGeometryMaterialFamily,
	VisualGeometryMaterialPass,
	VisualGeometryMaterialTableEntry,
	VisualGeometryPayload,
	VisualGeometryRenderState,
} from "./visual-geometry";

export interface ObjectVisualBakeInput {
	readonly bundle: ObjectVisualRecipeBundle;
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	readonly maxMaterialEntriesPerRenderPart?: number;
	readonly partitionKeyByPartInstanceIndex?: ReadonlyMap<number, string>;
	readonly renderPartIdPrefix: string;
	readonly textureBindings?: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>;
}

export interface ObjectVisualTextureBinding {
	readonly dependency: TextureResourceDependencies;
	readonly textureUseId: string;
}

export interface ObjectVisualBakedRenderPart extends VisualGeometryPayload {
	readonly instanceIds: readonly string[];
	readonly partInstanceIndices: readonly number[];
	readonly renderPartId: string;
	/** Source-local geometry for reusable visual resources; direct draw units use transformed fields. */
	readonly sourceLocalPayload: VisualGeometryPayload;
	readonly sourcePartIndices: readonly number[];
}

export interface ObjectVisualBakeResult {
	readonly animationPartBindings: readonly DynamicAnimationPartBinding[];
	readonly renderParts: readonly ObjectVisualBakedRenderPart[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
}

interface RenderablePrimitive {
	readonly buffer: ObjectVisualGeometryBuffer;
	readonly instanceId: string;
	readonly materialEntry: VisualGeometryMaterialTableEntry;
	readonly materialEntryKey: string;
	readonly materialFamily: VisualGeometryMaterialFamily;
	readonly materialPass: VisualGeometryMaterialPass;
	readonly materialTextureRoleLayoutKey: string;
	readonly materialTextureRoleSchemaKey: string;
	readonly partInstanceIndex: number;
	readonly partitionKey: string | null;
	readonly renderState: VisualGeometryRenderState;
	readonly sourcePartIndex: number | null;
	readonly triangleFirstVertex: number;
	readonly transform: Float32Array;
}

interface PrimitivePartition {
	readonly key: string;
	readonly primitives: readonly RenderablePrimitive[];
}

export function bakeObjectVisuals(
	input: ObjectVisualBakeInput,
): ObjectVisualBakeResult {
	const primitives = expandRenderablePrimitives(input);
	const partitions = partitionRenderablePrimitives({
		maxMaterialEntries:
			input.maxMaterialEntriesPerRenderPart ??
			MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
		primitives,
	});
	const renderParts = partitions.map((partition, partitionIndex) =>
		createRenderPart({
			partition,
			renderPartId: `${input.renderPartIdPrefix}:render-part:${partitionIndex}`,
		}),
	);

	return {
		animationPartBindings: createAnimationPartBindings(renderParts),
		renderParts,
		textureDependencies: uniqueTextureDependencies(
			renderParts.flatMap((part) =>
				part.materialEntries.flatMap((entry) =>
					[
						entry.primaryTextureUseId,
						entry.indexTextureUseId,
						entry.paletteTextureUseId,
						entry.detailTextureUseId,
					].filter(
						(textureUseId): textureUseId is string => textureUseId !== null,
					),
				),
			),
			input.textureBindings ?? new Map(),
		),
	};
}

function expandRenderablePrimitives(
	input: ObjectVisualBakeInput,
): readonly RenderablePrimitive[] {
	const primitives: RenderablePrimitive[] = [];
	for (const [
		partInstanceIndex,
		instance,
	] of input.bundle.partInstances.entries()) {
		const partRecipe = input.bundle.partRecipes.get(instance.partRecipeId);
		if (!partRecipe) {
			throw new Error(
				`Object visual instance ${instance.instanceId} references missing part recipe ${instance.partRecipeId}.`,
			);
		}
		const geometryRecipe = input.bundle.geometryRecipes.get(
			partRecipe.geometryRecipeId,
		);
		if (!geometryRecipe) {
			throw new Error(
				`Object visual part recipe ${instance.partRecipeId} references missing geometry recipe ${partRecipe.geometryRecipeId}.`,
			);
		}
		const buffer = input.geometryBuffers.get(geometryRecipe.bufferId);
		if (!buffer) {
			throw new Error(
				`Object visual geometry recipe ${partRecipe.geometryRecipeId} references missing geometry buffer ${geometryRecipe.bufferId}.`,
			);
		}
		const bindingsBySurfaceId = new Map(
			partRecipe.materialBindings.map((binding) => [
				binding.geometrySurfaceId,
				binding,
			]),
		);

		for (const triangle of buffer.triangles) {
			if (triangle.surfaceId === null) {
				continue;
			}
			const binding = bindingsBySurfaceId.get(triangle.surfaceId);
			if (!binding) {
				continue;
			}
			const materialRecipe = input.bundle.materialRecipes.get(
				binding.materialRecipeId,
			);
			if (!materialRecipe) {
				throw new Error(
					`Object visual material binding references missing material recipe ${binding.materialRecipeId}.`,
				);
			}
			const material = createMaterialTableEntry({
				materialRecipe,
				materialRecipeId: binding.materialRecipeId,
				slot: binding.materialSlot,
				textureBindings: input.textureBindings ?? new Map(),
			});
			if (!material) {
				if (materialRecipe.family !== "unsupported") {
					throw new Error(
						`Object visual material recipe ${binding.materialRecipeId} did not produce a renderable material entry.`,
					);
				}
				console.warn(
					`Skipped unsupported object visual material ${binding.materialRecipeId}: ${materialRecipe.reason}`,
				);
				continue;
			}
			primitives.push({
				buffer,
				instanceId: instance.instanceId,
				materialEntry: material.entry,
				materialEntryKey: createMaterialEntryKey(binding.materialRecipeId),
				materialFamily: material.family,
				materialPass: material.pass,
				materialTextureRoleLayoutKey: materialRecipe.textureRoleLayoutKey,
				materialTextureRoleSchemaKey: materialRecipe.textureRoleSchemaKey,
				partInstanceIndex,
				partitionKey:
					input.partitionKeyByPartInstanceIndex?.get(partInstanceIndex) ?? null,
				renderState: material.entry.renderState,
				sourcePartIndex: instance.sourcePartIndex,
				transform: new Float32Array(instance.transform),
				triangleFirstVertex: triangle.firstVertex,
			});
		}
	}
	return primitives.sort(compareRenderablePrimitives);
}

function createMaterialTableEntry(options: {
	readonly materialRecipe: ObjectVisualMaterialRecipe;
	readonly materialRecipeId: ObjectVisualMaterialRecipeId;
	readonly slot: number;
	readonly textureBindings: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>;
}): {
	readonly entry: VisualGeometryMaterialTableEntry;
	readonly family: VisualGeometryMaterialFamily;
	readonly pass: VisualGeometryMaterialPass;
} | null {
	const baseEntry = {
		alphaTest: options.materialRecipe.alphaTest,
		detailTextureTiling: options.materialRecipe.detailTextureTiling,
		detailTextureUseId: null,
		indexTextureUseId: null,
		indexedClipThreshold: options.materialRecipe.indexedClipThreshold,
		indexedTextureFormat: null,
		materialColor: options.materialRecipe.materialColor,
		materialEmissiveColor: options.materialRecipe.materialEmissiveColor,
		materialIds: [options.materialRecipeId],
		paletteFirstIndex: options.materialRecipe.paletteFirstIndex,
		paletteTextureUseId: null,
		primaryTextureUseId: null,
		primaryTextureWrapMode: options.materialRecipe.primaryTextureWrapMode,
		renderState: options.materialRecipe.renderState,
		slot: options.slot,
	};

	switch (options.materialRecipe.family) {
		case "direct-color":
			return {
				entry: {
					...baseEntry,
				},
				family: "flat-color",
				pass: options.materialRecipe.pass,
			};
		case "indexed-color":
			return {
				entry: {
					...baseEntry,
					indexTextureUseId: requireTextureBinding(
						options.textureBindings,
						options.materialRecipe.colorTextureRecipeId,
					).textureUseId,
					indexedTextureFormat: options.materialRecipe.indexedTextureFormat,
					paletteTextureUseId: requireTextureBinding(
						options.textureBindings,
						options.materialRecipe.paletteTextureRecipeId,
					).textureUseId,
				},
				family: "indexed-paletted",
				pass: options.materialRecipe.pass,
			};
		case "texture-rgba":
			return {
				entry: {
					...baseEntry,
					detailTextureUseId:
						options.materialRecipe.detailTextureRecipeId === null
							? null
							: requireTextureBinding(
									options.textureBindings,
									options.materialRecipe.detailTextureRecipeId,
								).textureUseId,
					primaryTextureUseId: requireTextureBinding(
						options.textureBindings,
						options.materialRecipe.rgbaTextureRecipeId,
					).textureUseId,
				},
				family: "texture-rgba",
				pass: options.materialRecipe.pass,
			};
		case "unsupported":
			return null;
	}
}

function requireTextureBinding(
	textureBindings: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>,
	textureRecipeId: ObjectVisualTextureRecipeId,
): ObjectVisualTextureBinding {
	const binding = textureBindings.get(textureRecipeId);
	if (!binding) {
		throw new Error(
			`Object visual material recipe references unbound texture recipe ${textureRecipeId}.`,
		);
	}
	return binding;
}

function partitionRenderablePrimitives(options: {
	readonly maxMaterialEntries: number;
	readonly primitives: readonly RenderablePrimitive[];
}): readonly PrimitivePartition[] {
	const groups = new Map<string, RenderablePrimitive[]>();
	for (const primitive of options.primitives) {
		const key = createPartitionKey(primitive);
		const group = groups.get(key);
		if (group) {
			group.push(primitive);
		} else {
			groups.set(key, [primitive]);
		}
	}

	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([key, primitives]) =>
			splitByMaterialBudget(primitives, options.maxMaterialEntries).map(
				(splitPrimitives, splitIndex) => ({
					key: `${key}|split:${splitIndex}`,
					primitives: splitPrimitives,
				}),
			),
		);
}

function splitByMaterialBudget(
	primitives: readonly RenderablePrimitive[],
	maxMaterialEntries: number,
): readonly (readonly RenderablePrimitive[])[] {
	const splits: RenderablePrimitive[][] = [];
	let current: RenderablePrimitive[] = [];
	let currentMaterialEntryKeys = new Set<string>();

	for (const primitive of primitives) {
		if (
			current.length > 0 &&
			!currentMaterialEntryKeys.has(primitive.materialEntryKey) &&
			currentMaterialEntryKeys.size >= maxMaterialEntries
		) {
			splits.push(current);
			current = [];
			currentMaterialEntryKeys = new Set<string>();
		}
		current.push(primitive);
		currentMaterialEntryKeys.add(primitive.materialEntryKey);
	}

	if (current.length > 0) {
		splits.push(current);
	}
	return splits;
}

function createRenderPart(options: {
	readonly partition: PrimitivePartition;
	readonly renderPartId: string;
}): ObjectVisualBakedRenderPart {
	const vertexCount = options.partition.primitives.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const sourceLocalPositions = new Float32Array(vertexCount * 3);
	const texCoords = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices =
		vertexCount > 65535
			? new Uint32Array(vertexCount)
			: new Uint16Array(vertexCount);
	const materialEntries = uniqueMaterialEntries(options.partition.primitives);
	const slotByMaterialEntryKey = new Map(
		materialEntries.map((entry, localSlot) => [
			createMaterialTableEntryKey(entry),
			localSlot,
		]),
	);

	for (const [
		triangleIndex,
		primitive,
	] of options.partition.primitives.entries()) {
		const localSlot = slotByMaterialEntryKey.get(
			createMaterialTableEntryKey(primitive.materialEntry),
		);
		if (localSlot === undefined) {
			throw new Error(
				`Object visual partition ${options.partition.key} cannot remap material entry ${primitive.materialEntryKey}.`,
			);
		}
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const sourceVertexIndex = primitive.triangleFirstVertex + vertex;
			const targetVertexIndex = triangleIndex * 3 + vertex;
			assertSourceVertexAvailable(primitive.buffer, sourceVertexIndex);
			writeTransformedPosition({
				matrix: primitive.transform,
				positions,
				source: primitive.buffer.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			writeSourceLocalPosition({
				positions: sourceLocalPositions,
				source: primitive.buffer.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			writeTexCoord({
				source: primitive.buffer.texCoords,
				sourceVertexIndex,
				target: texCoords,
				targetVertexIndex,
			});
			materialSlotIndices[targetVertexIndex] = localSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	const firstPrimitive = options.partition.primitives[0];
	if (!firstPrimitive) {
		throw new Error(
			`Object visual partition ${options.partition.key} has no primitives.`,
		);
	}

	const sharedPayload: Omit<VisualGeometryPayload, "positions"> = {
		bounds: firstPrimitive.buffer.bounds,
		indexType: indices instanceof Uint16Array ? "uint16" : "uint32",
		indices,
		materialEntries: materialEntries.map((entry, slot) => ({
			...entry,
			slot,
		})),
		materialFamily: firstPrimitive.materialFamily,
		materialPass: firstPrimitive.materialPass,
		materialSlotIndices,
		renderState: firstPrimitive.renderState,
		texCoords,
		textureUseIds: uniqueSortedStrings(
			materialEntries.flatMap((entry) =>
				[
					entry.primaryTextureUseId,
					entry.indexTextureUseId,
					entry.paletteTextureUseId,
					entry.detailTextureUseId,
				].filter(
					(textureUseId): textureUseId is string => textureUseId !== null,
				),
			),
		),
		triangleCount: options.partition.primitives.length,
		vertexCount,
	};

	return {
		...sharedPayload,
		instanceIds: uniqueSortedStrings(
			options.partition.primitives.map((primitive) => primitive.instanceId),
		),
		partInstanceIndices: uniqueSortedNumbers(
			options.partition.primitives.map(
				(primitive) => primitive.partInstanceIndex,
			),
		),
		positions,
		renderPartId: options.renderPartId,
		sourceLocalPayload: {
			...sharedPayload,
			positions: sourceLocalPositions,
		},
		sourcePartIndices: uniqueSortedNumbers(
			options.partition.primitives
				.map((primitive) => primitive.sourcePartIndex)
				.filter(
					(sourcePartIndex): sourcePartIndex is number =>
						sourcePartIndex !== null,
				),
		),
	};
}

function writeSourceLocalPosition(options: {
	readonly positions: Float32Array;
	readonly source: Float32Array;
	readonly sourceVertexIndex: number;
	readonly targetVertexIndex: number;
}): void {
	const sourceOffset = options.sourceVertexIndex * 3;
	const targetOffset = options.targetVertexIndex * 3;
	options.positions[targetOffset] = options.source[sourceOffset] ?? 0;
	options.positions[targetOffset + 1] = options.source[sourceOffset + 1] ?? 0;
	options.positions[targetOffset + 2] = options.source[sourceOffset + 2] ?? 0;
}

function createAnimationPartBindings(
	renderParts: readonly ObjectVisualBakedRenderPart[],
): readonly DynamicAnimationPartBinding[] {
	const renderPartIdsBySourcePartIndex = new Map<number, string[]>();
	for (const renderPart of renderParts) {
		for (const sourcePartIndex of renderPart.sourcePartIndices) {
			const renderPartIds =
				renderPartIdsBySourcePartIndex.get(sourcePartIndex) ?? [];
			renderPartIds.push(renderPart.renderPartId);
			renderPartIdsBySourcePartIndex.set(sourcePartIndex, renderPartIds);
		}
	}
	return [...renderPartIdsBySourcePartIndex.entries()]
		.sort(([left], [right]) => left - right)
		.map(([sourcePartIndex, renderPartIds]) => ({
			renderPartIds: uniqueSortedStrings(renderPartIds),
			sourcePartIndex,
		}));
}

function createPartitionKey(primitive: RenderablePrimitive): string {
	return [
		`family:${primitive.materialFamily}`,
		`pass:${primitive.materialPass}`,
		`partition:${primitive.partitionKey ?? "none"}`,
		`state:${JSON.stringify(primitive.renderState)}`,
		`roleLayout:${primitive.materialTextureRoleLayoutKey}`,
		`roleSchema:${primitive.materialTextureRoleSchemaKey}`,
		`sourcePart:${primitive.sourcePartIndex ?? "none"}`,
		`textures:${primitive.materialEntry.primaryTextureUseId ?? ""}:${primitive.materialEntry.indexTextureUseId ?? ""}:${primitive.materialEntry.paletteTextureUseId ?? ""}:${primitive.materialEntry.detailTextureUseId ?? ""}`,
	].join("|");
}

function createMaterialEntryKey(id: ObjectVisualMaterialRecipeId): string {
	return `material:${id}`;
}

function createMaterialTableEntryKey(
	entry: VisualGeometryMaterialTableEntry,
): string {
	return [
		entry.materialIds.join(","),
		entry.primaryTextureUseId ?? "",
		entry.indexTextureUseId ?? "",
		entry.paletteTextureUseId ?? "",
		entry.detailTextureUseId ?? "",
		entry.materialColor.join(","),
	].join("|");
}

function uniqueMaterialEntries(
	primitives: readonly RenderablePrimitive[],
): readonly VisualGeometryMaterialTableEntry[] {
	const entriesByKey = new Map<string, VisualGeometryMaterialTableEntry>();
	for (const primitive of primitives) {
		entriesByKey.set(
			createMaterialTableEntryKey(primitive.materialEntry),
			primitive.materialEntry,
		);
	}
	return [...entriesByKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, entry]) => entry);
}

function uniqueTextureDependencies(
	textureUseIds: readonly string[],
	textureBindings: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>,
): readonly TextureResourceDependencies[] {
	const requestedTextureUseIds = new Set(textureUseIds);
	const dependenciesByKey = new Map<string, TextureResourceDependencies>();
	for (const binding of textureBindings.values()) {
		if (requestedTextureUseIds.has(binding.textureUseId)) {
			dependenciesByKey.set(binding.textureUseId, binding.dependency);
		}
	}
	return [...dependenciesByKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, dependency]) => dependency);
}

function assertSourceVertexAvailable(
	buffer: ObjectVisualGeometryBuffer,
	sourceVertexIndex: number,
): void {
	if (
		sourceVertexIndex < 0 ||
		sourceVertexIndex >= buffer.vertexCount ||
		sourceVertexIndex * 3 + 2 >= buffer.positions.length ||
		sourceVertexIndex * 2 + 1 >= buffer.texCoords.length
	) {
		throw new Error(
			`Object visual geometry buffer ${buffer.bufferId} triangle references missing vertex ${sourceVertexIndex}.`,
		);
	}
}

function compareRenderablePrimitives(
	left: RenderablePrimitive,
	right: RenderablePrimitive,
): number {
	return (
		left.instanceId.localeCompare(right.instanceId) ||
		left.triangleFirstVertex - right.triangleFirstVertex ||
		left.materialEntryKey.localeCompare(right.materialEntryKey)
	);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
