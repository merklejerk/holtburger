import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";
import type {
	AtlasStaticCompactionMaterialSlot,
	AtlasStaticCompactionPlan,
} from "./atlas-static-compaction-planner";
import type { RenderMat4 } from "./render-math";

export interface AtlasStaticCompactedDrawRange {
	drawUnitId: string;
	firstIndex: number;
	indexCount: number;
	materialSlotIndex: number;
}

export interface AtlasStaticCompactedDrawSlice {
	key: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	firstIndex: number;
	indexCount: number;
	drawUnitIds: readonly string[];
	materialSlotKeys: readonly string[];
}

export interface AtlasStaticCompactedGeometry {
	key: string;
	positions: Float32Array;
	uvs: Float32Array;
	materialSlots: Float32Array;
	transformSlots: Float32Array;
	transformTable: readonly RenderMat4[];
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawRanges: readonly AtlasStaticCompactedDrawRange[];
	drawSlices: readonly AtlasStaticCompactedDrawSlice[];
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	transformSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
}

export function buildAtlasStaticCompactedGeometry({
	plan,
	drawUnits,
}: {
	plan: AtlasStaticCompactionPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
}): AtlasStaticCompactedGeometry | null {
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
				`Atlas static compaction plan references missing draw unit ${drawUnitId}.`,
			);
		}
		assertCompactedStaticDrawUnit(drawUnit);
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
	const transformSlots = new Float32Array(vertexCount);
	const indices = createCompactedIndexArray(vertexCount, indexCount);
	const drawRanges: AtlasStaticCompactedDrawRange[] = [];
	const transformTable: RenderMat4[] = [];
	let vertexOffset = 0;
	let indexOffset = 0;
	for (const [transformSlotIndex, drawUnit] of compactableDrawUnits.entries()) {
		const eligibility =
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.atlasEligibility
				: null;
		if (!eligibility) {
			throw new Error(
				`Atlas static compaction draw unit ${drawUnit.id} has no atlas eligibility.`,
			);
		}
		const materialSlot = materialSlotByKey.get(eligibility.materialSlotKey);
		if (!materialSlot) {
			throw new Error(
				`Atlas static compaction draw unit ${drawUnit.id} references missing material slot ${eligibility.materialSlotKey}.`,
			);
		}
		positions.set(drawUnit.geometry.positions, vertexOffset * 3);
		uvs.set(drawUnit.geometry.uvs, vertexOffset * 2);
		materialSlots.fill(
			materialSlot.index,
			vertexOffset,
			vertexOffset + drawUnit.geometry.vertexCount,
		);
		transformSlots.fill(
			transformSlotIndex,
			vertexOffset,
			vertexOffset + drawUnit.geometry.vertexCount,
		);
		transformTable.push(drawUnit.modelMatrix);
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
	const transformSlotByteLength = transformSlots.byteLength;
	const indexByteLength = indices.byteLength;
	return {
		key: describeCompactedGeometryKey(plan, compactableDrawUnits),
		positions,
		uvs,
		materialSlots,
		transformSlots,
		transformTable,
		indices,
		vertexCount,
		indexCount,
		triangleCount: plan.triangleCount,
		drawRanges,
		drawSlices,
		positionByteLength,
		uvByteLength,
		materialSlotByteLength,
		transformSlotByteLength,
		indexByteLength,
		totalByteLength:
			positionByteLength +
			uvByteLength +
			materialSlotByteLength +
			transformSlotByteLength +
			indexByteLength,
	};
}

function assertCompactedStaticDrawUnit(
	drawUnit: StagedWorldDrawUnitAssembly,
): asserts drawUnit is StagedWorldDrawUnitAssembly & {
	kind: "static";
	geometry: { uvs: Float32Array };
} {
	if (drawUnit.kind !== "static") {
		throw new Error(
			`Atlas static compaction cannot compact non-static draw unit ${drawUnit.id}.`,
		);
	}
	if (drawUnit.material.kind !== "direct-texture") {
		throw new Error(
			`Atlas static compaction cannot compact ${drawUnit.material.kind} draw unit ${drawUnit.id}.`,
		);
	}
	if (!drawUnit.geometry.uvs) {
		throw new Error(
			`Atlas static compaction draw unit ${drawUnit.id} has no UVs.`,
		);
	}
}

function compactDrawSlice({
	slice,
	rangeByDrawUnitId,
	materialSlotByKey,
}: {
	slice: AtlasStaticCompactionPlan["drawSlices"][number];
	rangeByDrawUnitId: ReadonlyMap<string, AtlasStaticCompactedDrawRange>;
	materialSlotByKey: ReadonlyMap<string, AtlasStaticCompactionMaterialSlot>;
}): AtlasStaticCompactedDrawSlice {
	const ranges = slice.drawUnitIds.map((drawUnitId) => {
		const range = rangeByDrawUnitId.get(drawUnitId);
		if (!range) {
			throw new Error(
				`Atlas static draw slice ${slice.key} references missing compacted draw unit ${drawUnitId}.`,
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
				`Atlas static draw slice ${slice.key} references missing material slot ${materialSlotKey}.`,
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

function describeCompactedGeometryKey(
	plan: AtlasStaticCompactionPlan,
	drawUnits: readonly StagedWorldDrawUnitAssembly[],
): string {
	return [
		"atlas-static-geometry",
		plan.key,
		...drawUnits.map((drawUnit) =>
			[
				drawUnit.id,
				`v${drawUnit.geometry.vertexCount}`,
				`t${drawUnit.geometry.triangleCount}`,
				`p${hashFloat32Array(drawUnit.geometry.positions)}`,
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
