import type { ResolvedObjectPart } from "../resolution/presentation";
import type { DynamicGeometryData } from "../renderer/geometry";
import { createObjectGeometryKey, type ObjectGeometryKey } from "./types";

/** One effective geometry layout shared independently from placement and material appearance. */
export interface DynamicLayout {
	/** Logical geometry lease key derived from ordered effective part geometry identities. */
	readonly key: ObjectGeometryKey;
	/** Source-local vertex streams with dense pose/material selectors. */
	readonly geometry: DynamicGeometryData;
	/** Array position is the dense pose selector; ranges retain original per-part index order. */
	readonly parts: readonly {
		/** Authored part index used to fetch its current pose. */
		readonly partIndex: number;
		/** Offset into the merged index buffer, in indices rather than bytes. */
		readonly indexStart: number;
		/** Number of indices belonging to this part. */
		readonly indexCount: number;
	}[];
}

/** Canonical geometry-only layout key derived from ordered effective part geometry identities. */
export function dynamicLayoutKey(
	sourceParts: readonly ResolvedObjectPart[],
): ObjectGeometryKey {
	const ordered = [...sourceParts].sort((a, b) => a.partIndex - b.partIndex);
	return orderedDynamicLayoutKey(ordered);
}

function orderedDynamicLayoutKey(
	ordered: readonly ResolvedObjectPart[],
): ObjectGeometryKey {
	return createObjectGeometryKey(
		`dynamic-layout:${JSON.stringify(ordered.map((part) => [part.partIndex, part.geometry.id]))}`,
	);
}

/** Compile geometry only; scales, appearances, visibility, and atlas coordinates remain separate. */
export function compileDynamicLayout(
	sourceParts: readonly ResolvedObjectPart[],
): DynamicLayout {
	const ordered = [...sourceParts].sort((a, b) => a.partIndex - b.partIndex);
	const key = orderedDynamicLayoutKey(ordered);
	const { totalIndices, totalSourceVertices } =
		validateAndMeasureParts(ordered);

	const indices = new Uint32Array(totalIndices);
	let vertexCapacity =
		totalIndices === 0 ? 0 : Math.max(totalSourceVertices, 16);
	let positions = new Float32Array(vertexCapacity * 3);
	let normals = new Float32Array(vertexCapacity * 3);
	let textureCoordinates = new Float32Array(vertexCapacity * 2);
	let partSelectors = new Uint32Array(vertexCapacity);
	let materialSelectors = new Uint32Array(vertexCapacity);
	let vertexWriteCount = 0;
	let indexWriteCount = 0;
	let materialCount = 0;
	const parts: DynamicLayout["parts"][number][] = [];

	const ensureVertexCapacity = (required: number): void => {
		if (required <= vertexCapacity) return;
		let nextCapacity = Math.max(vertexCapacity * 2, 16);
		while (nextCapacity < required) nextCapacity *= 2;
		positions = growFloat32(positions, nextCapacity * 3);
		normals = growFloat32(normals, nextCapacity * 3);
		textureCoordinates = growFloat32(textureCoordinates, nextCapacity * 2);
		partSelectors = growUint32(partSelectors, nextCapacity);
		materialSelectors = growUint32(materialSelectors, nextCapacity);
		vertexCapacity = nextCapacity;
	};

	for (const part of ordered) {
		const geometry = part.geometry;
		const srcPositions = geometry.positions;
		const srcNormals = geometry.normals;
		const srcUvs = geometry.textureCoordinates;
		const srcIndices = geometry.indices;
		const srcSlots = geometry.materialSlotIndices;
		const srcWraps = geometry.materialWrapModes;
		const vertexCount = srcPositions.length / 3;
		const triangleCount = srcIndices.length / 3;
		const densePart = parts.length;
		const indexStart = indexWriteCount;
		const slots = new Map<number, { selector: number; vertices: Int32Array }>();
		for (let triangle = 0; triangle < triangleCount; triangle += 1) {
			const slot = srcSlots[triangle];
			const wrap = srcWraps[triangle];
			if (slot === undefined || wrap === undefined)
				throw new Error(
					`Validated dynamic geometry ${geometry.id} lost triangle material data.`,
				);
			if (wrap !== 0 && wrap !== 1)
				throw new Error(
					`Dynamic geometry ${geometry.id} has invalid wrap mode ${wrap}.`,
				);
			// The low bit is wrap; Uint16 source slots cannot collide in this numeric key.
			const slotKey = slot * 2 + wrap;
			let selected = slots.get(slotKey);
			if (selected === undefined) {
				const remap = new Int32Array(vertexCount);
				remap.fill(-1);
				selected = { selector: materialCount++, vertices: remap };
				slots.set(slotKey, selected);
			}
			const triBase = triangle * 3;
			for (let corner = 0; corner < 3; corner += 1) {
				const vertex = srcIndices[triBase + corner];
				if (vertex === undefined || vertex >= vertexCount)
					throw new Error(
						`Dynamic geometry ${geometry.id} has an out-of-range vertex index.`,
					);
				let mergedVertex = selected.vertices[vertex];
				if (mergedVertex === undefined || mergedVertex === -1) {
					mergedVertex = vertexWriteCount;
					vertexWriteCount += 1;
					ensureVertexCapacity(vertexWriteCount);
					selected.vertices[vertex] = mergedVertex;
					const v3 = vertex * 3;
					const v2 = vertex * 2;
					const px = srcPositions[v3];
					const py = srcPositions[v3 + 1];
					const pz = srcPositions[v3 + 2];
					const nx = srcNormals[v3];
					const ny = srcNormals[v3 + 1];
					const nz = srcNormals[v3 + 2];
					const u = srcUvs[v2];
					const v = srcUvs[v2 + 1];
					if (
						px === undefined ||
						py === undefined ||
						pz === undefined ||
						nx === undefined ||
						ny === undefined ||
						nz === undefined ||
						u === undefined ||
						v === undefined
					)
						throw new Error(
							`Validated dynamic geometry ${geometry.id} lost vertex attributes.`,
						);
					const dst3 = mergedVertex * 3;
					const dst2 = mergedVertex * 2;
					positions[dst3] = px;
					positions[dst3 + 1] = py;
					positions[dst3 + 2] = pz;
					normals[dst3] = nx;
					normals[dst3 + 1] = ny;
					normals[dst3 + 2] = nz;
					textureCoordinates[dst2] = u;
					textureCoordinates[dst2 + 1] = v;
					partSelectors[mergedVertex] = densePart;
					materialSelectors[mergedVertex] = selected.selector;
				}
				indices[indexWriteCount] = mergedVertex;
				indexWriteCount += 1;
			}
		}
		parts.push({
			partIndex: part.partIndex,
			indexStart,
			indexCount: indexWriteCount - indexStart,
		});
	}

	const exactSize = vertexWriteCount === vertexCapacity;
	return {
		key,
		parts,
		geometry: {
			kind: "dynamic-parts",
			partCount: parts.length,
			materialCount,
			positions: exactSize
				? positions
				: positions.slice(0, vertexWriteCount * 3),
			normals: exactSize ? normals : normals.slice(0, vertexWriteCount * 3),
			textureCoordinates: exactSize
				? textureCoordinates
				: textureCoordinates.slice(0, vertexWriteCount * 2),
			indices,
			partSelectors: exactSize
				? partSelectors
				: partSelectors.slice(0, vertexWriteCount),
			materialSelectors: exactSize
				? materialSelectors
				: materialSelectors.slice(0, vertexWriteCount),
		},
	};
}

function validateAndMeasureParts(ordered: readonly ResolvedObjectPart[]): {
	readonly totalIndices: number;
	readonly totalSourceVertices: number;
} {
	let totalIndices = 0;
	let totalSourceVertices = 0;
	for (let partPos = 0; partPos < ordered.length; partPos += 1) {
		const part = ordered[partPos];
		if (part === undefined) continue;
		if (!Number.isSafeInteger(part.partIndex) || part.partIndex < 0)
			throw new Error(
				`Dynamic layout has invalid part index ${part.partIndex}.`,
			);
		const previous = partPos > 0 ? ordered[partPos - 1] : undefined;
		if (previous?.partIndex === part.partIndex)
			throw new Error(`Dynamic layout repeats part ${part.partIndex}.`);
		const geometry = part.geometry;
		const vertexCount = geometry.positions.length / 3;
		if (!Number.isInteger(vertexCount))
			throw new Error(
				`Dynamic geometry ${geometry.id} has incomplete positions.`,
			);
		if (geometry.normals.length !== geometry.positions.length)
			throw new Error(
				`Dynamic geometry ${geometry.id} has incomplete normals.`,
			);
		if (geometry.textureCoordinates.length !== vertexCount * 2)
			throw new Error(`Dynamic geometry ${geometry.id} has incomplete UVs.`);
		const triangleCount = geometry.indices.length / 3;
		if (!Number.isInteger(triangleCount))
			throw new Error(
				`Dynamic geometry ${geometry.id} has incomplete triangles.`,
			);
		if (geometry.materialSlotIndices.length !== triangleCount)
			throw new Error(
				`Dynamic geometry ${geometry.id} has incomplete material slots.`,
			);
		if (geometry.materialWrapModes.length !== triangleCount)
			throw new Error(
				`Dynamic geometry ${geometry.id} has incomplete wrap modes.`,
			);
		totalIndices += geometry.indices.length;
		totalSourceVertices += vertexCount;
	}
	return { totalIndices, totalSourceVertices };
}

function growFloat32(
	source: Float32Array,
	nextLength: number,
): Float32Array<ArrayBuffer> {
	const next = new Float32Array(nextLength);
	next.set(source);
	return next;
}

function growUint32(
	source: Uint32Array,
	nextLength: number,
): Uint32Array<ArrayBuffer> {
	const next = new Uint32Array(nextLength);
	next.set(source);
	return next;
}
