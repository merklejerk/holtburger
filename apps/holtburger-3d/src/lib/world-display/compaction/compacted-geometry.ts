import { createTranslationMat4, type RenderMat4 } from "../render-math";
import type { StagedWorldIndexedGeometry } from "../staged-world-geometry";

export interface CompactedGeometryBuildDrawUnit {
	id: string;
	kind: "static" | "structured-interior" | "portal-mask";
	geometry: StagedWorldIndexedGeometry;
	modelMatrix: RenderMat4;
	material: {
		kind: string;
	};
}

interface CompactedGeometryMaterialSlot {
	key: string;
	index: number;
}

interface CompactedGeometryDrawUnitMaterialSlot {
	drawUnitId: string;
	materialSlotKey: string;
}

export interface CompactedGeometryDrawSliceInput {
	key: string;
	renderStateKey: string;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

type CompactedGeometryLayout = "position-uv-material-slot";

export interface CompactedGeometryPlan<
	TDrawSlice extends CompactedGeometryDrawSliceInput =
		CompactedGeometryDrawSliceInput,
> {
	key: string;
	compactableDrawUnitIds: readonly string[];
	materialSlots: readonly CompactedGeometryMaterialSlot[];
	drawUnitMaterialSlots: readonly CompactedGeometryDrawUnitMaterialSlot[];
	drawSlices: readonly TDrawSlice[];
	triangleCount: number;
}

interface CompactedDrawRange {
	drawUnitId: string;
	firstIndex: number;
	indexCount: number;
	materialSlotIndex: number;
}

interface CompactedGeometrySlice {
	key: string;
	renderStateKey: string;
	firstIndex: number;
	indexCount: number;
	drawUnitIds: readonly string[];
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
	drawUnits,
	batchOrigin,
}: {
	plan: CompactedGeometryPlan<TDrawSlice>;
	drawUnits: readonly CompactedGeometryBuildDrawUnit[];
	batchOrigin: { x: number; y: number; z: number };
}): CompactedGeometryBatch | null {
	if (plan.compactableDrawUnitIds.length === 0) {
		return null;
	}
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const materialSlotByKey = new Map(
		plan.materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const materialSlotKeyByDrawUnitId = new Map(
		plan.drawUnitMaterialSlots.map(
			(record) => [record.drawUnitId, record.materialSlotKey] as const,
		),
	);
	const compactableDrawUnits = orderCompactedDrawUnitsBySlice({
		plan,
		drawUnitById,
	});
	const vertexCount = compactableDrawUnits.reduce(
		(total, drawUnit) => total + drawUnit.geometry.vertexCount,
		0,
	);
	const indexCount = compactableDrawUnits.reduce(
		(total, drawUnit) => total + drawUnit.geometry.indices.length,
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
	for (const drawUnit of compactableDrawUnits) {
		const materialSlotKey = resolveCompactedGeometryMaterialSlotKey({
			drawUnit,
			materialSlotKeyByDrawUnitId,
		});
		const materialSlot = materialSlotByKey.get(materialSlotKey);
		if (!materialSlot) {
			throw new Error(
				`Compacted geometry draw unit ${drawUnit.id} references missing material slot ${materialSlotKey}.`,
			);
		}
		compactDrawUnitPositions({
			target: positions,
			targetVertexOffset: vertexOffset,
			source: drawUnit.geometry.positions,
			modelMatrix: drawUnit.modelMatrix,
			batchOrigin,
		});
		if (!drawUnit.geometry.uvs) {
			throw new Error(
				`Compacted geometry draw unit ${drawUnit.id} has no UV buffer.`,
			);
		}
		uvs.set(drawUnit.geometry.uvs, vertexOffset * 2);
		materialSlotIndices.fill(
			materialSlot.index,
			vertexOffset,
			vertexOffset + drawUnit.geometry.vertexCount,
		);
		for (let index = 0; index < drawUnit.geometry.indices.length; index += 1) {
			indices[indexOffset + index] =
				(drawUnit.geometry.indices[index] ?? 0) + vertexOffset;
		}
		drawRanges.push({
			drawUnitId: drawUnit.id,
			firstIndex: indexOffset,
			indexCount: drawUnit.geometry.indices.length,
			materialSlotIndex: materialSlot.index,
		});
		vertexOffset += drawUnit.geometry.vertexCount;
		indexOffset += drawUnit.geometry.indices.length;
	}
	const rangeByDrawUnitId = new Map(
		drawRanges.map((range) => [range.drawUnitId, range] as const),
	);
	const drawSlices = plan.drawSlices.map((slice) =>
		compactDrawSlice({
			slice,
			rangeByDrawUnitId,
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
			drawUnits: compactableDrawUnits,
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

function compactDrawUnitPositions({
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

function assertCompactedGeometryDrawUnit(
	drawUnit: CompactedGeometryBuildDrawUnit,
): asserts drawUnit is CompactedGeometryBuildDrawUnit & {
	kind: "static" | "structured-interior";
	geometry: { uvs: Float32Array };
} {
	if (drawUnit.kind !== "static" && drawUnit.kind !== "structured-interior") {
		throw new Error(
			`Compacted geometry cannot compact ${drawUnit.kind} draw unit ${drawUnit.id}.`,
		);
	}
	if (!drawUnit.geometry.uvs) {
		throw new Error(`Compacted geometry draw unit ${drawUnit.id} has no UVs.`);
	}
}

function resolveCompactedGeometryMaterialSlotKey({
	drawUnit,
	materialSlotKeyByDrawUnitId,
}: {
	drawUnit: CompactedGeometryBuildDrawUnit;
	materialSlotKeyByDrawUnitId: ReadonlyMap<string, string>;
}): string {
	const explicitSlotKey = materialSlotKeyByDrawUnitId.get(drawUnit.id);
	if (explicitSlotKey) {
		return explicitSlotKey;
	}
	throw new Error(
		`Compacted geometry draw unit ${drawUnit.id} has no explicit material slot for ${drawUnit.material.kind} material.`,
	);
}

function compactDrawSlice({
	slice,
	rangeByDrawUnitId,
	materialSlotByKey,
}: {
	slice: CompactedGeometryDrawSliceInput;
	rangeByDrawUnitId: ReadonlyMap<string, CompactedDrawRange>;
	materialSlotByKey: ReadonlyMap<string, CompactedGeometryMaterialSlot>;
}): CompactedGeometrySlice {
	const ranges = slice.drawUnitIds.map((drawUnitId) => {
		const range = rangeByDrawUnitId.get(drawUnitId);
		if (!range) {
			throw new Error(
				`Compacted geometry draw slice ${slice.key} references missing compacted draw unit ${drawUnitId}.`,
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
		drawUnitIds: slice.drawUnitIds,
		materialSlotKeys: slice.materialSlotKeys,
	};
}

function orderCompactedDrawUnitsBySlice<
	TDrawSlice extends CompactedGeometryDrawSliceInput,
>({
	plan,
	drawUnitById,
}: {
	plan: CompactedGeometryPlan<TDrawSlice>;
	drawUnitById: ReadonlyMap<string, CompactedGeometryBuildDrawUnit>;
}): CompactedGeometryBuildDrawUnit[] {
	const sliceOrdinalByDrawUnitId = new Map<string, number>();
	for (const [sliceOrdinal, slice] of plan.drawSlices.entries()) {
		for (const drawUnitId of slice.drawUnitIds) {
			const previous = sliceOrdinalByDrawUnitId.get(drawUnitId);
			if (previous !== undefined) {
				throw new Error(
					`Compacted geometry draw unit ${drawUnitId} appears in multiple draw slices (${previous} and ${sliceOrdinal}).`,
				);
			}
			sliceOrdinalByDrawUnitId.set(drawUnitId, sliceOrdinal);
		}
	}
	return plan.compactableDrawUnitIds
		.map((drawUnitId) => {
			const drawUnit = drawUnitById.get(drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`Compacted geometry plan references missing draw unit ${drawUnitId}.`,
				);
			}
			assertCompactedGeometryDrawUnit(drawUnit);
			if (!sliceOrdinalByDrawUnitId.has(drawUnit.id)) {
				throw new Error(
					`Compacted geometry draw unit ${drawUnit.id} has no draw slice.`,
				);
			}
			return drawUnit;
		})
		.sort((left, right) => {
			const leftOrdinal = sliceOrdinalByDrawUnitId.get(left.id);
			const rightOrdinal = sliceOrdinalByDrawUnitId.get(right.id);
			if (leftOrdinal === undefined || rightOrdinal === undefined) {
				throw new Error(
					"Compacted geometry slice ordering lost a validated draw unit.",
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
				`Compacted geometry draw slice ${slice.key} is not contiguous at draw unit ${range.drawUnitId}.`,
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
	drawUnits,
	batchOrigin,
}: {
	plan: CompactedGeometryPlan;
	drawUnits: readonly CompactedGeometryBuildDrawUnit[];
	batchOrigin: { x: number; y: number; z: number };
}): string {
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const compactableDrawUnits = orderCompactedDrawUnitsBySlice({
		plan,
		drawUnitById,
	});
	const drawUnitSignature = compactableDrawUnits
		.map((drawUnit) =>
			[
				drawUnit.id,
				drawUnit.geometry.signature,
				`v${drawUnit.geometry.vertexCount}`,
				`t${drawUnit.geometry.triangleCount}`,
				`u${drawUnit.geometry.uvs ? drawUnit.geometry.uvs.length : "none"}`,
				`i${drawUnit.geometry.indices.length}`,
				`m${describeBatchRelativeMat4Signature(
					drawUnit.modelMatrix,
					batchOrigin,
				)}`,
			].join(":"),
		)
		.join("|");
	return [
		"compacted-geometry",
		`plan=${hashString(plan.key)}`,
		`draws=${compactableDrawUnits.length}`,
		`du=${hashString(drawUnitSignature)}`,
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
