import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";
import type {
	AtlasBackedCompactionMaterialSlot,
	AtlasBackedCompactionPlan,
} from "./atlas-backed-compaction-planner";
import { createTranslationMat4, type RenderMat4 } from "./render-math";

export interface AtlasBackedCompactedDrawRange {
	drawUnitId: string;
	firstIndex: number;
	indexCount: number;
	materialSlotIndex: number;
}

export interface AtlasBackedCompactedDrawSlice {
	key: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	firstIndex: number;
	indexCount: number;
	drawUnitIds: readonly string[];
	materialSlotKeys: readonly string[];
}

export interface AtlasBackedCompactedGeometry {
	key: string;
	positions: Float32Array;
	uvs: Float32Array;
	materialSlots: Float32Array;
	batchModelMatrix: RenderMat4;
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawRanges: readonly AtlasBackedCompactedDrawRange[];
	drawSlices: readonly AtlasBackedCompactedDrawSlice[];
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
}

export function buildAtlasBackedCompactedGeometry({
	plan,
	drawUnits,
	batchOrigin,
}: {
	plan: AtlasBackedCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	batchOrigin: { x: number; y: number; z: number };
}): AtlasBackedCompactedGeometry | null {
	if (plan.compactableDrawUnitIds.length === 0) {
		return null;
	}
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const materialSlotByKey = new Map(
		plan.materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const compactableDrawUnits = plan.compactableDrawUnitIds.map((drawUnitId) => {
		const drawUnit = drawUnitById.get(drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Atlas-backed compaction plan references missing draw unit ${drawUnitId}.`,
			);
		}
		assertAtlasBackedCompactedGeometryDrawUnit(drawUnit);
		return drawUnit;
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
	const materialSlots = new Float32Array(vertexCount);
	const indices = createCompactedIndexArray(vertexCount, indexCount);
	const drawRanges: AtlasBackedCompactedDrawRange[] = [];
	const batchModelMatrix = createTranslationMat4(batchOrigin);
	let vertexOffset = 0;
	let indexOffset = 0;
	for (const drawUnit of compactableDrawUnits) {
		const eligibility =
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.atlasEligibility
				: null;
		if (!eligibility) {
			throw new Error(
				`Atlas-backed compaction draw unit ${drawUnit.id} has no atlas eligibility.`,
			);
		}
		const materialSlot = materialSlotByKey.get(eligibility.materialSlotKey);
		if (!materialSlot) {
			throw new Error(
				`Atlas-backed compaction draw unit ${drawUnit.id} references missing material slot ${eligibility.materialSlotKey}.`,
			);
		}
		bakeDrawUnitPositions({
			target: positions,
			targetVertexOffset: vertexOffset,
			source: drawUnit.geometry.positions,
			modelMatrix: drawUnit.modelMatrix,
			batchOrigin,
		});
		uvs.set(drawUnit.geometry.uvs, vertexOffset * 2);
		materialSlots.fill(
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
	const materialSlotByteLength = materialSlots.byteLength;
	const indexByteLength = indices.byteLength;
	return {
		key: describeCompactedGeometryKey({
			plan,
			drawUnits: compactableDrawUnits,
			positions,
		}),
		positions,
		uvs,
		materialSlots,
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

function bakeDrawUnitPositions({
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

function assertAtlasBackedCompactedGeometryDrawUnit(
	drawUnit: StagedWorldDrawUnitAssembly,
): asserts drawUnit is StagedWorldDrawUnitAssembly & {
	kind: "static" | "structured-interior";
	geometry: { uvs: Float32Array };
} {
	if (drawUnit.kind !== "static" && drawUnit.kind !== "structured-interior") {
		throw new Error(
			`Atlas compacted geometry cannot compact ${drawUnit.kind} draw unit ${drawUnit.id}.`,
		);
	}
	if (drawUnit.material.kind !== "direct-texture") {
		throw new Error(
			`Atlas compacted geometry cannot compact ${drawUnit.material.kind} draw unit ${drawUnit.id}.`,
		);
	}
	if (!drawUnit.geometry.uvs) {
		throw new Error(
			`Atlas compacted geometry draw unit ${drawUnit.id} has no UVs.`,
		);
	}
}

function compactDrawSlice({
	slice,
	rangeByDrawUnitId,
	materialSlotByKey,
}: {
	slice: AtlasBackedCompactionPlan["drawSlices"][number];
	rangeByDrawUnitId: ReadonlyMap<string, AtlasBackedCompactedDrawRange>;
	materialSlotByKey: ReadonlyMap<string, AtlasBackedCompactionMaterialSlot>;
}): AtlasBackedCompactedDrawSlice {
	const ranges = slice.drawUnitIds.map((drawUnitId) => {
		const range = rangeByDrawUnitId.get(drawUnitId);
		if (!range) {
			throw new Error(
				`Atlas-backed compacted draw slice ${slice.key} references missing compacted draw unit ${drawUnitId}.`,
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
	for (const materialSlotKey of slice.materialSlotKeys) {
		if (!materialSlotByKey.has(materialSlotKey)) {
			throw new Error(
				`Atlas-backed compacted draw slice ${slice.key} references missing material slot ${materialSlotKey}.`,
			);
		}
	}
	return {
		key: slice.key,
		atlasTextureIndex: slice.atlasTextureIndex,
		renderStateKey: slice.renderStateKey,
		firstIndex,
		indexCount,
		drawUnitIds: slice.drawUnitIds,
		materialSlotKeys: slice.materialSlotKeys,
	};
}

function createCompactedIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount > 0xffff
		? new Uint32Array(indexCount)
		: new Uint16Array(indexCount);
}

function describeCompactedGeometryKey({
	plan,
	drawUnits,
	positions,
}: {
	plan: AtlasBackedCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	positions: Float32Array;
}): string {
	return [
		"atlas-backed-compacted-geometry",
		plan.key,
		`bp${hashFloat32Array(positions)}`,
		...drawUnits.map((drawUnit) =>
			[
				drawUnit.id,
				`v${drawUnit.geometry.vertexCount}`,
				`t${drawUnit.geometry.triangleCount}`,
				`u${hashFloat32Array(drawUnit.geometry.uvs ?? new Float32Array())}`,
				`i${hashIndexArray(drawUnit.geometry.indices)}`,
			].join(":"),
		),
	].join("|");
}

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
	for (let offset = 0; offset < view.byteLength; offset += 1) {
		hash ^= view.getUint8(offset);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function hashIndexArray(values: Uint16Array | Uint32Array): string {
	let hash = 0x811c9dc5;
	for (const value of values) {
		hash ^= value;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
