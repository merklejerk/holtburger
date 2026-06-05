import {
	buildCompactedGeometryBatch,
	type CompactedGeometryBatch,
	type CompactedGeometryBuildDrawUnit,
	type CompactedGeometryPlan,
} from "../compaction/compacted-geometry";
import type { RenderMat4 } from "../render-math";

export interface BuildCompactedGeometryWorkerJob {
	type: "build-compacted-geometry";
	key: string;
	input: BuildCompactedGeometryWorkerInput;
}

export interface BuildCompactedGeometryWorkerResult {
	type: "build-compacted-geometry";
	key: string;
	geometry: CompactedGeometryBatch | null;
}

export interface BuildCompactedGeometryWorkerInput {
	key: string;
	plan: CompactedGeometryPlan;
	drawUnits: readonly CompactedGeometryBuildDrawUnit[];
	batchOrigin: { x: number; y: number; z: number };
}

export function createBuildCompactedGeometryWorkerInput({
	key,
	plan,
	drawUnits,
	batchOrigin,
}: {
	key: string;
	plan: CompactedGeometryPlan;
	drawUnits: readonly CompactedGeometryBuildDrawUnit[];
	batchOrigin: { x: number; y: number; z: number };
}): BuildCompactedGeometryWorkerInput {
	const compactableDrawUnitIds = new Set(plan.compactableDrawUnitIds);
	return {
		key,
		plan,
		drawUnits: drawUnits
			.filter((drawUnit) => compactableDrawUnitIds.has(drawUnit.id))
			.map(copyCompactedGeometryBuildDrawUnit),
		batchOrigin,
	};
}

export function buildCompactedGeometryWorkerResult(
	input: BuildCompactedGeometryWorkerInput,
): BuildCompactedGeometryWorkerResult {
	return {
		type: "build-compacted-geometry",
		key: input.key,
		geometry: buildCompactedGeometryBatch({
			plan: input.plan,
			drawUnits: input.drawUnits,
			batchOrigin: input.batchOrigin,
		}),
	};
}

export function collectBuildCompactedGeometryInputTransferables(
	input: BuildCompactedGeometryWorkerInput,
): Transferable[] {
	return uniqueTransferables(
		input.drawUnits.flatMap((drawUnit) => [
			drawUnit.geometry.positions.buffer,
			drawUnit.geometry.uvs?.buffer,
			drawUnit.geometry.indices.buffer,
			drawUnit.modelMatrix.buffer,
		]),
	);
}

export function collectBuildCompactedGeometryResultTransferables(
	result: BuildCompactedGeometryWorkerResult,
): Transferable[] {
	const geometry = result.geometry;
	if (!geometry) {
		return [];
	}
	return uniqueTransferables([
		geometry.positions.buffer,
		geometry.uvs.buffer,
		geometry.materialSlotIndices.buffer,
		geometry.indices.buffer,
		geometry.batchModelMatrix.buffer,
	]);
}

function copyCompactedGeometryBuildDrawUnit(
	drawUnit: CompactedGeometryBuildDrawUnit,
): CompactedGeometryBuildDrawUnit {
	return {
		id: drawUnit.id,
		kind: drawUnit.kind,
		geometry: {
			signature: drawUnit.geometry.signature,
			positions: new Float32Array(drawUnit.geometry.positions),
			uvs: drawUnit.geometry.uvs
				? new Float32Array(drawUnit.geometry.uvs)
				: null,
			indices: copyIndexArray(drawUnit.geometry.indices),
			vertexCount: drawUnit.geometry.vertexCount,
			triangleCount: drawUnit.geometry.triangleCount,
		},
		modelMatrix: new Float32Array(drawUnit.modelMatrix) as RenderMat4,
		material: {
			kind: drawUnit.material.kind,
		},
	};
}

function copyIndexArray(
	indices: Uint16Array | Uint32Array,
): Uint16Array | Uint32Array {
	return indices instanceof Uint16Array
		? new Uint16Array(indices)
		: new Uint32Array(indices);
}

function uniqueTransferables(
	buffers: readonly (ArrayBufferLike | undefined)[],
): Transferable[] {
	const transferables = new Set<Transferable>();
	for (const buffer of buffers) {
		if (buffer instanceof ArrayBuffer) {
			transferables.add(buffer);
		}
	}
	return [...transferables];
}
