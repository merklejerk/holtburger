import type { PreparedTerrainMesh, PreparedTerrainQuad } from "../assets/types";
import type { TerrainBlendPlan, TerrainBlendPlanSet } from "./terrain-blend-plan";
import type { StagedWorldIndexedGeometry } from "./staged-world-geometry";

const DEFAULT_TERRAIN_TILE_LAYER_LIMIT = 8;

export interface TerrainTileLayerPlan {
	layerEntries: TerrainTileLayerEntry[];
	layerSlotByPcode: ReadonlyMap<number, number>;
	blockers: readonly string[];
	signature: string;
}

export interface TerrainTileLayerEntry {
	slot: number;
	pcode: number;
	plan: TerrainBlendPlan;
	colorRefCount: number;
	maskRefCount: number;
}

export interface TerrainTileLayerGeometry extends StagedWorldIndexedGeometry {
	uvs: Float32Array;
	layerSlots: Float32Array;
}

export interface TerrainTileDrawSlicePlan {
	id: string;
	reason: string;
	layerPlan: TerrainTileLayerPlan;
	pcodes: readonly number[];
}

export function buildTerrainTileFallbackGeometry(
	mesh: PreparedTerrainMesh,
): StagedWorldIndexedGeometry {
	const positions = new Float32Array(mesh.vertices.length * 3);
	for (const [vertexIndex, vertex] of mesh.vertices.entries()) {
		writeVec3(positions, vertexIndex, vertex.x, vertex.z, -vertex.y);
	}

	const indices = createIndexArray(mesh.vertices.length, mesh.triangles.length * 3);
	for (const [triangleIndex, triangle] of mesh.triangles.entries()) {
		const firstIndex = triangleIndex * 3;
		indices[firstIndex] = triangle.a;
		indices[firstIndex + 1] = triangle.b;
		indices[firstIndex + 2] = triangle.c;
	}

	return {
		positions,
		uvs: null,
		indices,
		vertexCount: mesh.vertices.length,
		triangleCount: mesh.triangles.length,
	};
}

export function buildTerrainTileLayerPlan({
	planSet,
	maxLayerEntries = DEFAULT_TERRAIN_TILE_LAYER_LIMIT,
}: {
	planSet: TerrainBlendPlanSet | null;
	maxLayerEntries?: number;
}): TerrainTileLayerPlan | null {
	if (!planSet) {
		return null;
	}
	const plans = [...planSet.plans].sort((left, right) => left.pcode - right.pcode);
	if (plans.length > maxLayerEntries) {
		return {
			layerEntries: [],
			layerSlotByPcode: new Map(),
			blockers: [
				`terrain tile requires ${plans.length} layer entries; limit is ${maxLayerEntries}`,
			],
			signature: `${planSet.signature}|layer-overflow:${plans.length}/${maxLayerEntries}`,
		};
	}
	const layerEntries = plans.map((plan, slot): TerrainTileLayerEntry => ({
		slot,
		pcode: plan.pcode,
		plan,
		colorRefCount: countTerrainLayerColorRefs(plan),
		maskRefCount: countTerrainLayerMaskRefs(plan),
	}));
	return {
		layerEntries,
		layerSlotByPcode: new Map(
			layerEntries.map((entry) => [entry.pcode, entry.slot] as const),
		),
		blockers: [],
		signature: [
			planSet.signature,
			`layers:${layerEntries.map((entry) => `${entry.slot}:${entry.pcode}`).join(",")}`,
		].join("|"),
	};
}

export function buildTerrainTileDrawSlicePlans({
	planSet,
	maxLayerEntries = DEFAULT_TERRAIN_TILE_LAYER_LIMIT,
}: {
	planSet: TerrainBlendPlanSet | null;
	maxLayerEntries?: number;
}): TerrainTileDrawSlicePlan[] {
	if (!planSet) {
		return [];
	}
	const plans = [...planSet.plans].sort((left, right) => left.pcode - right.pcode);
	if (plans.length <= maxLayerEntries) {
		const layerPlan = buildTerrainTileLayerPlanFromPlans({
			planSet,
			plans,
			signatureSuffix: "slice:single",
		});
		return layerPlan
			? [
					{
						id: "slice/0",
						reason: "terrain tile fits one-draw layer limit",
						layerPlan,
						pcodes: plans.map((plan) => plan.pcode),
					},
				]
			: [];
	}
	const slices: TerrainTileDrawSlicePlan[] = [];
	for (
		let firstPlanIndex = 0;
		firstPlanIndex < plans.length;
		firstPlanIndex += maxLayerEntries
	) {
		const sliceIndex = slices.length;
		const slicePlans = plans.slice(firstPlanIndex, firstPlanIndex + maxLayerEntries);
		const layerPlan = buildTerrainTileLayerPlanFromPlans({
			planSet,
			plans: slicePlans,
			signatureSuffix: `slice:${sliceIndex}`,
		});
		if (!layerPlan) {
			continue;
		}
		slices.push({
			id: `slice/${sliceIndex}`,
			reason: `terrain tile layer overflow slice ${sliceIndex + 1}`,
			layerPlan,
			pcodes: slicePlans.map((plan) => plan.pcode),
		});
	}
	return slices;
}

export function buildTerrainTileLayerGeometry({
	mesh,
	plan,
}: {
	mesh: PreparedTerrainMesh;
	plan: TerrainTileLayerPlan;
}): TerrainTileLayerGeometry {
	const quadsByIndex = new Map(
		mesh.quads.map((quad) => [quad.quadIndex, quad]),
	);
	const triangles = mesh.triangles.filter((triangle) => {
		const quad = quadsByIndex.get(triangle.quadIndex);
		return quad ? plan.layerSlotByPcode.has(quad.pcode) : false;
	});
	const vertexCount = triangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const layerSlots = new Float32Array(vertexCount);
	const indices = createIndexArray(vertexCount, vertexCount);

	for (const [triangleIndex, triangle] of triangles.entries()) {
		const quad = quadsByIndex.get(triangle.quadIndex);
		if (!quad) {
			continue;
		}
		const layerSlot = plan.layerSlotByPcode.get(quad.pcode);
		if (layerSlot === undefined) {
			continue;
		}
		const firstVertex = triangleIndex * 3;
		for (const [corner, sourceVertexIndex] of [
			triangle.a,
			triangle.b,
			triangle.c,
		].entries()) {
			const targetVertexIndex = firstVertex + corner;
			const vertex = mesh.vertices[sourceVertexIndex];
			writeVec3(positions, targetVertexIndex, vertex.x, vertex.z, -vertex.y);
			writeVec2(uvs, targetVertexIndex, terrainQuadUv(quad, sourceVertexIndex));
			layerSlots[targetVertexIndex] = layerSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		positions,
		uvs,
		layerSlots,
		indices,
		vertexCount,
		triangleCount: triangles.length,
	};
}

function countTerrainLayerColorRefs(plan: TerrainBlendPlan): number {
	return (
		1 +
		plan.overlays.length +
		(plan.roads.length > 0 ? 1 : 0)
	);
}

function countTerrainLayerMaskRefs(plan: TerrainBlendPlan): number {
	return plan.overlays.length + plan.roads.length;
}

function buildTerrainTileLayerPlanFromPlans({
	planSet,
	plans,
	signatureSuffix,
}: {
	planSet: TerrainBlendPlanSet;
	plans: readonly TerrainBlendPlan[];
	signatureSuffix: string;
}): TerrainTileLayerPlan | null {
	if (plans.length === 0) {
		return null;
	}
	const layerEntries = plans.map((plan, slot): TerrainTileLayerEntry => ({
		slot,
		pcode: plan.pcode,
		plan,
		colorRefCount: countTerrainLayerColorRefs(plan),
		maskRefCount: countTerrainLayerMaskRefs(plan),
	}));
	return {
		layerEntries,
		layerSlotByPcode: new Map(
			layerEntries.map((entry) => [entry.pcode, entry.slot] as const),
		),
		blockers: [],
		signature: [
			planSet.signature,
			signatureSuffix,
			`layers:${layerEntries.map((entry) => `${entry.slot}:${entry.pcode}`).join(",")}`,
		].join("|"),
	};
}

function terrainQuadUv(
	quad: PreparedTerrainQuad,
	vertexIndex: number,
): [number, number] {
	const cornerIndex = quad.vertexIndices.indexOf(vertexIndex);
	switch (cornerIndex) {
		case 0:
			return [0, 0];
		case 1:
			return [1, 0];
		case 2:
			return [1, 1];
		case 3:
			return [0, 1];
		default:
			return [0, 0];
	}
}

function writeVec3(
	target: Float32Array,
	vertexIndex: number,
	x: number,
	y: number,
	z: number,
): void {
	const offset = vertexIndex * 3;
	target[offset] = x;
	target[offset + 1] = y;
	target[offset + 2] = z;
}

function writeVec2(
	target: Float32Array,
	vertexIndex: number,
	value: readonly [number, number],
): void {
	const offset = vertexIndex * 2;
	target[offset] = value[0];
	target[offset + 1] = value[1];
}

function createIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount > 65535
		? new Uint32Array(indexCount)
		: new Uint16Array(indexCount);
}
