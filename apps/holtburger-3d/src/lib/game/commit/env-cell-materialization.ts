import type { EnvCellId, LandblockOwnerId } from "../game-types";
import {
	createObjectGeometryKey,
	createPortalGeometryKey,
	type GeometrySource,
	type ObjectGeometryKey,
	type PortalGeometryKey,
} from "../geometry/types";
import type { AABB3 } from "../math/types";
import { classifyObjectResidents } from "../resolution/object-resident-classifier";
import type {
	ResolvedEnvCellLayerSource,
	ResolvedEnvCellPresentation,
	ResolvedEnvCellStaticObjectSource,
	ResolvedObjectResident,
	ResolvedPortalAperture,
	ResolvedPortalCrossing,
} from "../resolution/landblock-layer";
import { qualifyPortalApertureId } from "../resolution/portal-scene-identity";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type {
	ResolvedGeometry,
	ResolvedMapSurface,
} from "../resolution/presentation";
import {
	bakeStaticLight,
	placeObjectLights,
	type PlacedStaticLight,
} from "./interior-static-lighting";

/** Authored EnvCell flag marking a cell that can see the outdoors. */
const ENV_CELL_SEEN_OUTSIDE_FLAG = 0x01;
import type {
	ObjectGeometryData,
	PortalGeometryData,
} from "../renderer/geometry";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ScenePlacement, SceneScope } from "../scene";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import { addAssetTextureFacts } from "../textures/texture-facts";
import type { ObjectMaterialBinding } from "./artifacts";
import { resolveObjectTriangleMaterial } from "./object-material-binding";
import { collectStaticObjectTextureDependencies } from "./static-object-texture-inputs";

const SURFACE_BASE1_TEXTURE_MASK = 0x06;

/** One contiguous CellStruct shell range with a complete renderer-neutral binding. */
interface EnvCellShellMaterialRange {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
}

/** One CellStruct instance whose geometry can be shared without sharing cell-selected materials. */
interface EnvCellShellMaterializationPlan {
	readonly envCellId: EnvCellId;
	readonly geometry: ObjectGeometryKey;
	readonly placement: ScenePlacement;
	/** Host-derived overhead-map floor for this cell's structure, in the same local frame. */
	readonly mapFloor: ResolvedMapSurface;
	readonly structureLocalBounds: AABB3;
	readonly landblockBounds: AABB3;
	readonly materialRanges: readonly EnvCellShellMaterialRange[];
}

/** Query and topology facts retained for one exact EnvCell scope. */
interface EnvCellScopeMaterializationPlan {
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
	readonly landblockBounds: AABB3;
	readonly structureToLandblock: ScenePlacement["localTransform"];
	readonly containmentPlanes: Float32Array;
	readonly potentiallyVisibleEnvCellIds: ReadonlySet<EnvCellId>;
	/** Authored SeenOutside flag, which decides whether a camera inside forces interior ambient. */
	readonly seenOutside: boolean;
	/** Host-derived depth-continuous island ordinal, dense within the owning record. */
	readonly visibilityIslandOrdinal: number;
}

/** One worker-ready resident source partition that cannot span EnvCell scopes. */
interface EnvCellResidentMaterializationJob {
	readonly id: `env-cell-resident-job:${string}`;
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
	readonly source: ResolvedEnvCellStaticObjectSource;
	readonly textureRequirements: readonly AssetTextureFact[];
}

/** Source-to-plan accounting consumed by later realization diagnostics. */
export interface EnvCellMaterializationDiagnostics {
	readonly expectedCellCount: number;
	readonly shellCount: number;
	readonly apertureCount: number;
	readonly crossingCount: number;
	readonly expectedResidentCount: number;
	readonly plannedStaticResidentCount: number;
	readonly defaultAnimatedResidentCount: number;
	readonly unsupportedResidentCount: 0;
	readonly shellMaterialRangeCount: number;
	readonly uniqueShellGeometryCount: number;
	readonly uniqueShellMaterialCount: number;
}

/** Complete source plan; runtime supplies revision namespaces and executes it in Phase 5. */
export interface EnvCellMaterializationPlan {
	readonly landblockId: LandblockOwnerId;
	readonly scopes: readonly EnvCellScopeMaterializationPlan[];
	readonly shellGeometries: readonly (GeometrySource & {
		readonly key: ObjectGeometryKey;
		readonly geometry: ObjectGeometryData;
	})[];
	readonly shells: readonly EnvCellShellMaterializationPlan[];
	readonly shellTextureRequirements: readonly AssetTextureFact[];
	readonly apertureGeometries: readonly (GeometrySource & {
		readonly key: PortalGeometryKey;
		readonly geometry: PortalGeometryData;
	})[];
	readonly apertures: readonly ResolvedPortalAperture[];
	readonly crossings: readonly ResolvedPortalCrossing[];
	readonly residentJobs: readonly EnvCellResidentMaterializationJob[];
	readonly dynamicSources: readonly import("../resolution/landblock-layer").AuthoredDynamicSource[];
	readonly diagnostics: EnvCellMaterializationDiagnostics;
}

/** Resolve one decoded EnvCell layer into closed, ordered, scope-partitioned work. */
export function planEnvCellMaterialization(
	source: ResolvedEnvCellLayerSource,
): EnvCellMaterializationPlan {
	const shellGeometries = new Map<
		ObjectGeometryKey,
		GeometrySource & {
			readonly key: ObjectGeometryKey;
			readonly geometry: ObjectGeometryData;
		}
	>();
	const shellTextureRequirements = new Map<AssetTextureKey, AssetTextureFact>();
	const shellMaterialIds = new Set<string>();
	const shells: EnvCellShellMaterializationPlan[] = [];
	const scopes: EnvCellScopeMaterializationPlan[] = [];
	const residentJobs: EnvCellResidentMaterializationJob[] = [];
	const dynamicSources: import("../resolution/landblock-layer").AuthoredDynamicSource[] =
		[];
	let expectedResidentCount = 0;
	let plannedStaticResidentCount = 0;
	let shellMaterialRangeCount = 0;

	// Retail bakes with the union of nearby visible cells' lights, not just the owning cell's,
	// which is how light reaches through doorways. Every light in the landblock is gathered once
	// and the authored range cutoff decides which cells each one actually reaches.
	const landblockLights: PlacedStaticLight[] = [];
	for (const cell of source.cells) {
		for (const resident of cell.residents) {
			placeObjectLights(
				resident.presentation.lights,
				resident.placement.localTransform,
				landblockLights,
			);
		}
	}

	for (const cell of source.cells) {
		assertCellIdentity(source.landblockId, cell);
		const geometry = cell.structure.geometry;
		const structureLocalBounds = geometry.bounds;
		if (structureLocalBounds === null) {
			throw new Error(`EnvCell ${cell.id} shell geometry has no local bounds.`);
		}
		if (cell.materials.length !== cell.structure.surfaceSlotCount) {
			throw new Error(
				`EnvCell ${cell.id} material count does not match its structure slots.`,
			);
		}
		// Baked lighting is per cell, so shell geometry is keyed per cell rather than shared by
		// CellStruct identity. Structures are tiny (median 10 vertices, max 113 across the whole
		// archive), so the duplication is far cheaper than splicing per-cell color streams onto
		// shared buffers.
		const bakedLight = bakeStaticLight(
			cell.structure.geometry.positions,
			cell.structure.geometry.normals,
			cell.structureToLandblock.localTransform,
			landblockLights,
		);
		const geometryKey = createObjectGeometryKey(
			`${cell.structure.geometry.id}/cell:${cell.id}`,
		);
		// The compacted index buffer is planned with the ranges that address it, so the two cannot
		// disagree about triangle order.
		const { indices, ranges: materialRanges } = planShellDraws(
			cell,
			shellTextureRequirements,
			shellMaterialIds,
		);
		if (!shellGeometries.has(geometryKey)) {
			shellGeometries.set(geometryKey, {
				key: geometryKey,
				geometry: objectGeometry(cell.structure.geometry, bakedLight, indices),
			});
		}
		shellMaterialRangeCount += materialRanges.length;
		shells.push({
			envCellId: cell.id,
			geometry: geometryKey,
			placement: cell.structureToLandblock,
			mapFloor: cell.structure.mapFloor,
			structureLocalBounds,
			landblockBounds: cell.landblockBounds,
			materialRanges,
		});
		scopes.push({
			scope: {
				kind: "env-cell",
				landblockId: source.landblockId,
				envCellId: cell.id,
			},
			landblockBounds: cell.landblockBounds,
			structureToLandblock: cell.structureToLandblock.localTransform,
			containmentPlanes: cell.structure.containmentPlanes,
			potentiallyVisibleEnvCellIds: cell.potentiallyVisibleEnvCellIds,
			seenOutside: (cell.flags & ENV_CELL_SEEN_OUTSIDE_FLAG) !== 0,
			visibilityIslandOrdinal: cell.visibilityIslandOrdinal,
		});

		const residents = cell.residents.map(resolveResident);
		expectedResidentCount += residents.length;
		const classified = classifyObjectResidents(residents);
		plannedStaticResidentCount += classified.staticResidents.length;
		dynamicSources.push(...classified.dynamicSources);
		const residentSource: ResolvedEnvCellStaticObjectSource = {
			kind: LandblockLayerKind.EnvCells,
			landblockId: source.landblockId,
			envCellId: cell.id,
			staticResidents: classified.staticResidents,
			dynamicSources: classified.dynamicSources,
			staticLights: landblockLights,
		};
		residentJobs.push({
			id: `env-cell-resident-job:${source.landblockId}/${cell.id}`,
			scope: {
				kind: "env-cell",
				landblockId: source.landblockId,
				envCellId: cell.id,
			},
			source: residentSource,
			textureRequirements:
				collectStaticObjectTextureDependencies(residentSource),
		});
	}

	return {
		landblockId: source.landblockId,
		scopes,
		shellGeometries: [...shellGeometries.values()],
		shells,
		shellTextureRequirements: [...shellTextureRequirements.values()].sort(
			(left, right) => left.key.localeCompare(right.key),
		),
		apertureGeometries: source.portalApertures.map((aperture) =>
			apertureGeometry(source.landblockId, aperture),
		),
		apertures: source.portalApertures,
		crossings: source.portalCrossings,
		residentJobs,
		dynamicSources,
		diagnostics: {
			expectedCellCount: source.cells.length,
			shellCount: shells.length,
			apertureCount: source.portalApertures.length,
			crossingCount: source.portalCrossings.length,
			expectedResidentCount,
			plannedStaticResidentCount,
			defaultAnimatedResidentCount: dynamicSources.length,
			unsupportedResidentCount: 0,
			shellMaterialRangeCount,
			uniqueShellGeometryCount: shellGeometries.size,
			uniqueShellMaterialCount: shellMaterialIds.size,
		},
	};
}

/**
 * Compact a shell's triangles into one binding-major index buffer and the ranges that tile it.
 *
 * The authored index order cannot be described by contiguous ranges without waste. Non-renderable
 * portal polygons are skipped, which punches holes that split a range even when its binding never
 * changed, and same-binding triangles are not necessarily adjacent to begin with. Emitting indices
 * grouped by binding makes every range contiguous by construction and drops the skipped triangles
 * from the uploaded buffer entirely.
 *
 * Reordering is safe here because shell geometry is already realized per cell rather than shared by
 * CellStruct identity, so this buffer has exactly one consumer.
 */
function planShellDraws(
	cell: ResolvedEnvCellPresentation,
	textureRequirements: Map<AssetTextureKey, AssetTextureFact>,
	materialIds: Set<string>,
): {
	readonly indices: Uint32Array;
	readonly ranges: readonly EnvCellShellMaterialRange[];
} {
	const geometry = cell.structure.geometry;
	if (geometry.indices.length % 3 !== 0) {
		throw new Error(`EnvCell ${cell.id} shell indices are not triangles.`);
	}
	if (geometry.materialSlotIndices.length * 3 !== geometry.indices.length) {
		throw new Error(
			`EnvCell ${cell.id} material slots do not cover its shell.`,
		);
	}
	// Insertion-ordered so a shell's draw order stays a deterministic function of authored order:
	// bindings appear in the order their first renderable triangle does.
	const trianglesByBinding = new Map<
		string,
		{
			readonly material: ObjectMaterialBinding;
			readonly ordering: ObjectMaterialOrdering;
			readonly triangles: number[];
		}
	>();
	for (
		let triangle = 0;
		triangle < geometry.materialSlotIndices.length;
		triangle += 1
	) {
		const resolved = resolveObjectTriangleMaterial({
			detailRole: "environment",
			geometry,
			materials: cell.materials,
			sourceLabel: `EnvCell ${cell.id} shell`,
			triangle,
		});
		// Retail keeps portal polygons in CellStruct geometry but excludes EnvCell surfaces
		// without a base image or clip map from both its immediate and built-mesh draw paths.
		if (
			(resolved.binding.source.rawSurfaceFlags & SURFACE_BASE1_TEXTURE_MASK) ===
			0
		) {
			continue;
		}
		addAssetTextureFacts(
			textureRequirements,
			resolved.textureRequirements,
			"EnvCell shell",
		);
		materialIds.add(resolved.binding.source.id);
		const group = trianglesByBinding.get(resolved.bindingId);
		if (group) {
			group.triangles.push(triangle);
			continue;
		}
		trianglesByBinding.set(resolved.bindingId, {
			material: resolved.binding,
			ordering: resolved.ordering,
			triangles: [triangle],
		});
	}

	let renderableTriangleCount = 0;
	for (const group of trianglesByBinding.values()) {
		renderableTriangleCount += group.triangles.length;
	}
	const indices = new Uint32Array(renderableTriangleCount * 3);
	const ranges: EnvCellShellMaterialRange[] = [];
	let cursor = 0;
	for (const group of trianglesByBinding.values()) {
		const indexStart = cursor;
		for (const triangle of group.triangles) {
			indices[cursor] = geometry.indices[triangle * 3]!;
			indices[cursor + 1] = geometry.indices[triangle * 3 + 1]!;
			indices[cursor + 2] = geometry.indices[triangle * 3 + 2]!;
			cursor += 3;
		}
		ranges.push({
			indexStart,
			indexCount: cursor - indexStart,
			material: group.material,
			ordering: group.ordering,
		});
	}
	// The ranges must tile the compacted buffer exactly: no gap, no overlap, nothing left over.
	if (cursor !== indices.length) {
		throw new Error(
			`EnvCell ${cell.id} shell material range accounting failed.`,
		);
	}
	return { indices, ranges };
}

function resolveResident(
	resident: ResolvedEnvCellPresentation["residents"][number],
): ResolvedObjectResident {
	return {
		identity: { kind: "authored", sourceId: resident.id },
		setupId: resident.setupId,
		presentation: resident.presentation,
		behavior: resident.behavior,
		placement: resident.placement,
		scale: resident.scale,
		localBounds: resident.localBounds,
	};
}

function assertCellIdentity(
	landblockId: LandblockOwnerId,
	cell: ResolvedEnvCellPresentation,
): void {
	if (
		cell.structureToLandblock.landblockId !== landblockId ||
		cell.structureToLandblock.envCellId !== cell.id ||
		cell.residents.some(
			(resident) =>
				resident.placement.landblockId !== landblockId ||
				resident.placement.envCellId !== cell.id,
		)
	) {
		throw new Error(
			`EnvCell ${cell.id} contains a placement with another residency.`,
		);
	}
}

/**
 * Realize shell geometry against a caller-supplied index buffer.
 *
 * Vertex streams are shared with the authored source, but indices are not: shells upload a
 * compacted, binding-major buffer that the authored order cannot express.
 */
function objectGeometry(
	geometry: ResolvedGeometry,
	bakedLight: Float32Array | null,
	indices: Uint32Array,
): ObjectGeometryData {
	return {
		kind: "object",
		positions: geometry.positions,
		normals: geometry.normals,
		textureCoordinates: geometry.textureCoordinates,
		indices,
		bakedLight,
	};
}

function apertureGeometry(
	landblockId: LandblockOwnerId,
	aperture: ResolvedPortalAperture,
): GeometrySource & {
	readonly key: PortalGeometryKey;
	readonly geometry: PortalGeometryData;
} {
	const key: PortalGeometryKey = createPortalGeometryKey(
		qualifyPortalApertureId(landblockId, aperture.id),
	);
	return {
		key,
		geometry: {
			kind: "portal-aperture",
			positions: aperture.positions,
			indices: aperture.triangleIndices,
		},
	};
}
