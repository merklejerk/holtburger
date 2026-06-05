import type { DetailedLandblockRenderArtifacts } from "../../landblock-render-product";
import {
	buildAcPlacementMatrix,
	createTranslationMat4,
	multiplyMat4,
	type RenderMat4,
	type RenderVec4,
} from "../../render-math";
import type { RenderChunkTransform } from "../../render-anchor";
import { buildStagedPolygonSetGeometry } from "../../staged-world-geometry";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "../../webgl2-gl";

type DetailedStructuredInteriorCellArtifact =
	DetailedLandblockRenderArtifacts["structuredInteriorCells"][number];

export interface Webgl2StructuredInteriorResourceStore {
	cellsByKey: Map<string, Webgl2StructuredInteriorCellResource>;
}

export interface Webgl2StructuredInteriorCellResource {
	key: string;
	artifactKey: string;
	landblockId: number;
	envCellId: number;
	geometrySignature: string;
	modelMatrix: RenderMat4;
	color: RenderVec4;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	indexCount: number;
	triangleCount: number;
	dispose(): void;
}

export function createWebgl2StructuredInteriorResourceStore(): Webgl2StructuredInteriorResourceStore {
	return {
		cellsByKey: new Map(),
	};
}

export function syncWebgl2StructuredInteriorResources({
	gl,
	store,
	artifacts,
	renderChunkTransforms,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2StructuredInteriorResourceStore;
	artifacts: readonly DetailedLandblockRenderArtifacts[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): void {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const retainedKeys = new Set<string>();
	for (const artifact of artifacts) {
		for (const cell of artifact.structuredInteriorCells) {
			const resourceKey = describeStructuredInteriorResourceKey(artifact, cell);
			retainedKeys.add(resourceKey);
			const modelMatrix = buildStructuredInteriorModelMatrix({
				cell,
				chunkOffsetByKey,
			});
			const previous = store.cellsByKey.get(resourceKey);
			if (
				previous &&
				previous.geometrySignature ===
					describeStructuredInteriorGeometrySignature(artifact, cell)
			) {
				previous.modelMatrix = modelMatrix;
				continue;
			}
			if (previous) {
				previous.dispose();
			}
			store.cellsByKey.set(
				resourceKey,
				createWebgl2StructuredInteriorCellResource({
					gl,
					artifact,
					cell,
					modelMatrix,
				}),
			);
		}
	}
	for (const [key, resource] of store.cellsByKey) {
		if (!retainedKeys.has(key)) {
			resource.dispose();
			store.cellsByKey.delete(key);
		}
	}
}

export function destroyWebgl2StructuredInteriorResources(
	store: Webgl2StructuredInteriorResourceStore,
): void {
	for (const resource of store.cellsByKey.values()) {
		resource.dispose();
	}
	store.cellsByKey.clear();
}

function createWebgl2StructuredInteriorCellResource({
	gl,
	artifact,
	cell,
	modelMatrix,
}: {
	gl: WebGL2RenderingContext;
	artifact: DetailedLandblockRenderArtifacts;
	cell: DetailedStructuredInteriorCellArtifact;
	modelMatrix: RenderMat4;
}): Webgl2StructuredInteriorCellResource {
	const geometry = buildStagedPolygonSetGeometry(cell.renderGeometry, {
		sourceSignature: cell.key,
	});
	const positionBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${cell.key}/positions`,
		data: geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${cell.key}/indices`,
		data: geometry.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${cell.key}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		key: describeStructuredInteriorResourceKey(artifact, cell),
		artifactKey: artifact.key,
		landblockId: cell.landblockId,
		envCellId: cell.envCellId,
		geometrySignature: describeStructuredInteriorGeometrySignature(
			artifact,
			cell,
		),
		modelMatrix,
		color: createStructuredInteriorCellColor(cell),
		vertexArray,
		positionBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		indexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		dispose() {
			vertexArray.dispose();
			positionBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}

function buildStructuredInteriorModelMatrix({
	cell,
	chunkOffsetByKey,
}: {
	cell: DetailedStructuredInteriorCellArtifact;
	chunkOffsetByKey: ReadonlyMap<string, { x: number; y: number; z: number }>;
}): RenderMat4 {
	const chunkOffset = chunkOffsetByKey.get(cell.renderChunk.chunkKey);
	if (!chunkOffset) {
		return buildAcPlacementMatrix(
			cell.localPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		);
	}
	return multiplyMat4(
		createTranslationMat4(chunkOffset),
		buildAcPlacementMatrix(
			cell.localPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
}

function describeStructuredInteriorResourceKey(
	artifact: DetailedLandblockRenderArtifacts,
	cell: DetailedStructuredInteriorCellArtifact,
): string {
	return [
		"structured-interior",
		artifact.product,
		artifact.landblockId,
		cell.envCellId,
		artifact.buildPolicyRevision,
		artifact.texturePagePolicyRevision,
	].join(":");
}

function describeStructuredInteriorGeometrySignature(
	artifact: DetailedLandblockRenderArtifacts,
	cell: DetailedStructuredInteriorCellArtifact,
): string {
	return [
		artifact.key,
		cell.key,
		cell.renderGeometry.sourceId,
		cell.renderGeometry.vertexCount,
		cell.renderGeometry.triangleCount,
		cell.renderGeometry.skippedPolygonCount ?? 0,
	].join(":");
}

function createStructuredInteriorCellColor(
	cell: DetailedStructuredInteriorCellArtifact,
): RenderVec4 {
	const hue = (cell.envCellId & 0xff) / 255;
	return new Float32Array([0.45 + hue * 0.25, 0.58, 0.72 - hue * 0.2, 1]);
}
