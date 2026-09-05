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

/** Compile geometry only; scales, appearances, visibility, and atlas coordinates remain separate. */
export function compileDynamicLayout(
	sourceParts: readonly ResolvedObjectPart[],
): DynamicLayout {
	const ordered = [...sourceParts].sort((a, b) => a.partIndex - b.partIndex);
	const key = createObjectGeometryKey(
		`dynamic-layout:${JSON.stringify(ordered.map((part) => [part.partIndex, part.geometry.id]))}`,
	);
	const positions: number[] = [];
	const normals: number[] = [];
	const textureCoordinates: number[] = [];
	const indices: number[] = [];
	const partSelectors: number[] = [];
	const materialSelectors: number[] = [];
	let materialCount = 0;
	const parts: DynamicLayout["parts"][number][] = [];
	for (const part of ordered) {
		if (!Number.isSafeInteger(part.partIndex) || part.partIndex < 0)
			throw new Error(
				`Dynamic layout has invalid part index ${part.partIndex}.`,
			);
		if (parts.at(-1)?.partIndex === part.partIndex)
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
		const densePart = parts.length;
		const indexStart = indices.length;
		const slots = new Map<
			number,
			{ selector: number; vertices: Map<number, number> }
		>();
		for (let triangle = 0; triangle < triangleCount; triangle += 1) {
			const slot = geometry.materialSlotIndices[triangle];
			const wrap = geometry.materialWrapModes[triangle];
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
				selected = { selector: materialCount++, vertices: new Map() };
				slots.set(slotKey, selected);
			}
			for (let corner = 0; corner < 3; corner += 1) {
				const vertex = geometry.indices[triangle * 3 + corner];
				if (vertex === undefined || vertex >= vertexCount)
					throw new Error(
						`Dynamic geometry ${geometry.id} has an out-of-range vertex index.`,
					);
				let mergedVertex = selected.vertices.get(vertex);
				if (mergedVertex === undefined) {
					mergedVertex = partSelectors.length;
					selected.vertices.set(vertex, mergedVertex);
					positions.push(
						...geometry.positions.subarray(vertex * 3, vertex * 3 + 3),
					);
					normals.push(
						...geometry.normals.subarray(vertex * 3, vertex * 3 + 3),
					);
					textureCoordinates.push(
						...geometry.textureCoordinates.subarray(vertex * 2, vertex * 2 + 2),
					);
					partSelectors.push(densePart);
					materialSelectors.push(selected.selector);
				}
				indices.push(mergedVertex);
			}
		}
		parts.push({
			partIndex: part.partIndex,
			indexStart,
			indexCount: indices.length - indexStart,
		});
	}
	return {
		key,
		parts,
		geometry: {
			kind: "dynamic-parts",
			partCount: parts.length,
			materialCount,
			positions: new Float32Array(positions),
			normals: new Float32Array(normals),
			textureCoordinates: new Float32Array(textureCoordinates),
			indices: new Uint32Array(indices),
			partSelectors: new Uint32Array(partSelectors),
			materialSelectors: new Uint32Array(materialSelectors),
		},
	};
}
