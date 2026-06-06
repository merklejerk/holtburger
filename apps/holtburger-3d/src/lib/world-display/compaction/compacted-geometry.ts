import { createTranslationMat4, type RenderMat4 } from "../render-math";
import type { RenderIndexedGeometry } from "../indexed-render-geometry";

export interface CompactedGeometryBuildEntry {
	id: string;
	kind: "static" | "structured-interior" | "portal-mask";
	geometry: RenderIndexedGeometry;
	modelMatrix: RenderMat4;
	material: {
		kind: string;
	};
}

interface CompactedGeometryMaterialSlot {
	key: string;
	index: number;
}

interface CompactedGeometryEntryMaterialSlot {
	entryId: string;
	materialSlotKey: string;
}

export interface CompactedGeometryDrawSliceInput {
	key: string;
	renderStateKey: string;
	materialSlotKeys: readonly string[];
	entryIds: readonly string[];
}

type CompactedGeometryLayout = "position-uv-material-slot";

export interface CompactedGeometryPlan<
	TDrawSlice extends CompactedGeometryDrawSliceInput =
		CompactedGeometryDrawSliceInput,
> {
	key: string;
	compactableEntryIds: readonly string[];
	materialSlots: readonly CompactedGeometryMaterialSlot[];
	entryMaterialSlots: readonly CompactedGeometryEntryMaterialSlot[];
	drawSlices: readonly TDrawSlice[];
	triangleCount: number;
}

interface CompactedDrawRange {
	entryId: string;
	firstIndex: number;
	indexCount: number;
	materialSlotIndex: number;
}

interface CompactedGeometrySlice {
	key: string;
	renderStateKey: string;
	firstIndex: number;
	indexCount: number;
	entryIds: readonly string[];
	materialSlotKeys: readonly string[];
}

export interface CompactedGeometryBatch {
	key: string;
	layout: CompactedGeometryLayout;
	positions: Float32Array;
	uvs: Float32Array;
	materialSlotIndices: Float32Array;
	batchModelMatrix: RenderMat4;
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawRanges: readonly CompactedDrawRange[];
	drawSlices: readonly CompactedGeometrySlice[];
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
}

export function buildCompactedGeometryBatch<
	TDrawSlice extends CompactedGeometryDrawSliceInput,
>({
	plan,
	entries,
	batchOrigin,
}: {
	plan: CompactedGeometryPlan<TDrawSlice>;
	entries: readonly CompactedGeometryBuildEntry[];
	batchOrigin: { x: number; y: number; z: number };
}): CompactedGeometryBatch | null {
	if (plan.compactableEntryIds.length === 0) {
		return null;
	}
	const entryById = new Map(
		entries.map((entry) => [entry.id, entry]),
	);
	const materialSlotByKey = new Map(
		plan.materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const materialSlotKeyByEntryId = new Map(
		plan.entryMaterialSlots.map(
			(record) => [record.entryId, record.materialSlotKey] as const,
		),
	);
	const compactableEntrys = orderCompactedEntrysBySlice({
		plan,
		entryById,
	});
	const vertexCount = compactableEntrys.reduce(
		(total, entry) => total + entry.geometry.vertexCount,
		0,
	);
	const indexCount = compactableEntrys.reduce(
		(total, entry) => total + entry.geometry.indices.length,
		0,
	);
	const positions = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices = createCompactedIndexArray(vertexCount, indexCount);
	const drawRanges: CompactedDrawRange[] = [];
	const batchModelMatrix = createTranslationMat4(batchOrigin);
	let vertexOffset = 0;
	let indexOffset = 0;
	for (const entry of compactableEntrys) {
		const materialSlotKey = resolveCompactedGeometryMaterialSlotKey({
			entry,
			materialSlotKeyByEntryId,
		});
		const materialSlot = materialSlotByKey.get(materialSlotKey);
		if (!materialSlot) {
			throw new Error(
				`Compacted geometry compaction entry ${entry.id} references missing material slot ${materialSlotKey}.`,
			);
		}
		compactEntryPositions({
			target: positions,
			targetVertexOffset: vertexOffset,
			source: entry.geometry.positions,
			modelMatrix: entry.modelMatrix,
			batchOrigin,
		});
		if (!entry.geometry.uvs) {
			throw new Error(
				`Compacted geometry compaction entry ${entry.id} has no UV buffer.`,
			);
		}
		uvs.set(entry.geometry.uvs, vertexOffset * 2);
		materialSlotIndices.fill(
			materialSlot.index,
			vertexOffset,
			vertexOffset + entry.geometry.vertexCount,
		);
		for (let index = 0; index < entry.geometry.indices.length; index += 1) {
			indices[indexOffset + index] =
				(entry.geometry.indices[index] ?? 0) + vertexOffset;
		}
		drawRanges.push({
			entryId: entry.id,
			firstIndex: indexOffset,
			indexCount: entry.geometry.indices.length,
			materialSlotIndex: materialSlot.index,
		});
		vertexOffset += entry.geometry.vertexCount;
		indexOffset += entry.geometry.indices.length;
	}
	const rangeByEntryId = new Map(
		drawRanges.map((range) => [range.entryId, range] as const),
	);
	const drawSlices = plan.drawSlices.map((slice) =>
		compactDrawSlice({
			slice,
			rangeByEntryId,
			materialSlotByKey,
		}),
	);
	const positionByteLength = positions.byteLength;
	const uvByteLength = uvs.byteLength;
	const materialSlotByteLength = materialSlotIndices.byteLength;
	const indexByteLength = indices.byteLength;
	return {
		key: describeCompactedGeometryJobKey({
			plan,
			entries: compactableEntrys,
			batchOrigin,
		}),
		layout: "position-uv-material-slot",
		positions,
		uvs,
		materialSlotIndices,
		batchModelMatrix,
		indices,
		vertexCount,
		indexCount,
		triangleCount: plan.triangleCount,
		drawRanges,
		drawSlices,
		positionByteLength,
		uvByteLength,
		materialSlotByteLength,
		indexByteLength,
		totalByteLength:
			positionByteLength +
			uvByteLength +
			materialSlotByteLength +
			indexByteLength,
	};
}

function compactEntryPositions({
	target,
	targetVertexOffset,
	source,
	modelMatrix,
	batchOrigin,
}: {
	target: Float32Array;
	targetVertexOffset: number;
	source: Float32Array;
	modelMatrix: RenderMat4;
	batchOrigin: { x: number; y: number; z: number };
}): void {
	for (let vertexIndex = 0; vertexIndex < source.length / 3; vertexIndex += 1) {
		const sourceOffset = vertexIndex * 3;
		const x = source[sourceOffset] ?? 0;
		const y = source[sourceOffset + 1] ?? 0;
		const z = source[sourceOffset + 2] ?? 0;
		const targetOffset = (targetVertexOffset + vertexIndex) * 3;
		target[targetOffset] =
			(modelMatrix[0] ?? 0) * x +
			(modelMatrix[4] ?? 0) * y +
			(modelMatrix[8] ?? 0) * z +
			(modelMatrix[12] ?? 0) -
			batchOrigin.x;
		target[targetOffset + 1] =
			(modelMatrix[1] ?? 0) * x +
			(modelMatrix[5] ?? 0) * y +
			(modelMatrix[9] ?? 0) * z +
			(modelMatrix[13] ?? 0) -
			batchOrigin.y;
		target[targetOffset + 2] =
			(modelMatrix[2] ?? 0) * x +
			(modelMatrix[6] ?? 0) * y +
			(modelMatrix[10] ?? 0) * z +
			(modelMatrix[14] ?? 0) -
			batchOrigin.z;
	}
}

function assertCompactedGeometryEntry(
	entry: CompactedGeometryBuildEntry,
): asserts entry is CompactedGeometryBuildEntry & {
	kind: "static" | "structured-interior";
	geometry: { uvs: Float32Array };
} {
	if (entry.kind !== "static" && entry.kind !== "structured-interior") {
		throw new Error(
			`Compacted geometry cannot compact ${entry.kind} compaction entry ${entry.id}.`,
		);
	}
	if (!entry.geometry.uvs) {
		throw new Error(`Compacted geometry compaction entry ${entry.id} has no UVs.`);
	}
}

function resolveCompactedGeometryMaterialSlotKey({
	entry,
	materialSlotKeyByEntryId,
}: {
	entry: CompactedGeometryBuildEntry;
	materialSlotKeyByEntryId: ReadonlyMap<string, string>;
}): string {
	const explicitSlotKey = materialSlotKeyByEntryId.get(entry.id);
	if (explicitSlotKey) {
		return explicitSlotKey;
	}
	throw new Error(
		`Compacted geometry compaction entry ${entry.id} has no explicit material slot for ${entry.material.kind} material.`,
	);
}

function compactDrawSlice({
	slice,
	rangeByEntryId,
	materialSlotByKey,
}: {
	slice: CompactedGeometryDrawSliceInput;
	rangeByEntryId: ReadonlyMap<string, CompactedDrawRange>;
	materialSlotByKey: ReadonlyMap<string, CompactedGeometryMaterialSlot>;
}): CompactedGeometrySlice {
	const ranges = slice.entryIds.map((entryId) => {
		const range = rangeByEntryId.get(entryId);
		if (!range) {
			throw new Error(
				`Compacted geometry draw slice ${slice.key} references missing compacted compaction entry ${entryId}.`,
			);
		}
		return range;
	});
	const sortedRanges = ranges.sort(
		(left, right) => left.firstIndex - right.firstIndex,
	);
	const firstIndex = sortedRanges[0]?.firstIndex ?? 0;
	const lastRange = sortedRanges[sortedRanges.length - 1];
	const indexCount = lastRange
		? lastRange.firstIndex + lastRange.indexCount - firstIndex
		: 0;
	assertCompactedDrawSliceIsContiguous({ slice, sortedRanges, firstIndex });
	for (const materialSlotKey of slice.materialSlotKeys) {
		if (!materialSlotByKey.has(materialSlotKey)) {
			throw new Error(
				`Compacted geometry draw slice ${slice.key} references missing material slot ${materialSlotKey}.`,
			);
		}
	}
	return {
		key: slice.key,
		renderStateKey: slice.renderStateKey,
		firstIndex,
		indexCount,
		entryIds: slice.entryIds,
		materialSlotKeys: slice.materialSlotKeys,
	};
}

function orderCompactedEntrysBySlice<
	TDrawSlice extends CompactedGeometryDrawSliceInput,
>({
	plan,
	entryById,
}: {
	plan: CompactedGeometryPlan<TDrawSlice>;
	entryById: ReadonlyMap<string, CompactedGeometryBuildEntry>;
}): CompactedGeometryBuildEntry[] {
	const sliceOrdinalByEntryId = new Map<string, number>();
	for (const [sliceOrdinal, slice] of plan.drawSlices.entries()) {
		for (const entryId of slice.entryIds) {
			const previous = sliceOrdinalByEntryId.get(entryId);
			if (previous !== undefined) {
				throw new Error(
					`Compacted geometry compaction entry ${entryId} appears in multiple draw slices (${previous} and ${sliceOrdinal}).`,
				);
			}
			sliceOrdinalByEntryId.set(entryId, sliceOrdinal);
		}
	}
	return plan.compactableEntryIds
		.map((entryId) => {
			const entry = entryById.get(entryId);
			if (!entry) {
				throw new Error(
					`Compacted geometry plan references missing compaction entry ${entryId}.`,
				);
			}
			assertCompactedGeometryEntry(entry);
			if (!sliceOrdinalByEntryId.has(entry.id)) {
				throw new Error(
					`Compacted geometry compaction entry ${entry.id} has no draw slice.`,
				);
			}
			return entry;
		})
		.sort((left, right) => {
			const leftOrdinal = sliceOrdinalByEntryId.get(left.id);
			const rightOrdinal = sliceOrdinalByEntryId.get(right.id);
			if (leftOrdinal === undefined || rightOrdinal === undefined) {
				throw new Error(
					"Compacted geometry slice ordering lost a validated compaction entry.",
				);
			}
			return leftOrdinal - rightOrdinal || left.id.localeCompare(right.id);
		});
}

function assertCompactedDrawSliceIsContiguous({
	slice,
	sortedRanges,
	firstIndex,
}: {
	slice: CompactedGeometryDrawSliceInput;
	sortedRanges: readonly CompactedDrawRange[];
	firstIndex: number;
}): void {
	let expectedFirstIndex = firstIndex;
	for (const range of sortedRanges) {
		if (range.firstIndex !== expectedFirstIndex) {
			throw new Error(
				`Compacted geometry draw slice ${slice.key} is not contiguous at compaction entry ${range.entryId}.`,
			);
		}
		expectedFirstIndex += range.indexCount;
	}
}

function createCompactedIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount > 0xffff
		? new Uint32Array(indexCount)
		: new Uint16Array(indexCount);
}

export function describeCompactedGeometryJobKey({
	plan,
	entries,
	batchOrigin,
}: {
	plan: CompactedGeometryPlan;
	entries: readonly CompactedGeometryBuildEntry[];
	batchOrigin: { x: number; y: number; z: number };
}): string {
	const entryById = new Map(
		entries.map((entry) => [entry.id, entry]),
	);
	const compactableEntrys = orderCompactedEntrysBySlice({
		plan,
		entryById,
	});
	const entrySignature = compactableEntrys
		.map((entry) =>
			[
				entry.id,
				entry.geometry.signature,
				`v${entry.geometry.vertexCount}`,
				`t${entry.geometry.triangleCount}`,
				`u${entry.geometry.uvs ? entry.geometry.uvs.length : "none"}`,
				`i${entry.geometry.indices.length}`,
				`m${describeBatchRelativeMat4Signature(
					entry.modelMatrix,
					batchOrigin,
				)}`,
			].join(":"),
		)
		.join("|");
	return [
		"compacted-geometry",
		`plan=${hashString(plan.key)}`,
		`draws=${compactableEntrys.length}`,
		`du=${hashString(entrySignature)}`,
	].join("|");
}

function hashString(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function describeBatchRelativeMat4Signature(
	matrix: RenderMat4,
	batchOrigin: { x: number; y: number; z: number },
): string {
	return Array.from(matrix, (value, index) => {
		switch (index) {
			case 12:
				return Number(value - batchOrigin.x).toPrecision(8);
			case 13:
				return Number(value - batchOrigin.y).toPrecision(8);
			case 14:
				return Number(value - batchOrigin.z).toPrecision(8);
			default:
				return Number(value).toPrecision(8);
		}
	}).join(",");
}
