import type { EnvCellId, LandblockId } from "../game-types";
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
import type { ResolvedGeometry } from "../resolution/presentation";
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
}

/** One worker-ready resident source partition that cannot span EnvCell scopes. */
interface EnvCellResidentMaterializationJob {
	readonly id: `env-cell-resident-job:${string}`;
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
	readonly source: ResolvedEnvCellStaticObjectSource;
	/** Landblock-space authored lights this cell's residents bake against. */
	readonly staticLights: readonly PlacedStaticLight[];
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
	readonly landblockId: LandblockId;
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
		if (!shellGeometries.has(geometryKey)) {
			shellGeometries.set(geometryKey, {
				key: geometryKey,
				geometry: objectGeometry(cell.structure.geometry, bakedLight),
			});
		}
		const materialRanges = planShellMaterialRanges(
			cell,
			shellTextureRequirements,
			shellMaterialIds,
		);
		shellMaterialRangeCount += materialRanges.length;
		shells.push({
			envCellId: cell.id,
			geometry: geometryKey,
			placement: cell.structureToLandblock,
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
		};
		residentJobs.push({
			id: `env-cell-resident-job:${source.landblockId}/${cell.id}`,
			scope: {
				kind: "env-cell",
				landblockId: source.landblockId,
				envCellId: cell.id,
			},
			source: residentSource,
			staticLights: landblockLights,
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

function planShellMaterialRanges(
	cell: ResolvedEnvCellPresentation,
	textureRequirements: Map<AssetTextureKey, AssetTextureFact>,
	materialIds: Set<string>,
): readonly EnvCellShellMaterialRange[] {
	const geometry = cell.structure.geometry;
	if (geometry.indices.length % 3 !== 0) {
		throw new Error(`EnvCell ${cell.id} shell indices are not triangles.`);
	}
	const ranges: Array<
		EnvCellShellMaterialRange & { readonly bindingId: string }
	> = [];
	let renderableIndexCount = 0;
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
		renderableIndexCount += 3;
		addAssetTextureFacts(
			textureRequirements,
			resolved.textureRequirements,
			"EnvCell shell",
		);
		materialIds.add(resolved.binding.source.id);
		const previous = ranges.at(-1);
		if (
			previous?.bindingId === resolved.bindingId &&
			previous.indexStart + previous.indexCount === triangle * 3
		) {
			ranges[ranges.length - 1] = {
				...previous,
				indexCount: previous.indexCount + 3,
			};
			continue;
		}
		ranges.push({
			bindingId: resolved.bindingId,
			indexStart: triangle * 3,
			indexCount: 3,
			material: resolved.binding,
			ordering: resolved.ordering,
		});
	}
	if (
		geometry.materialSlotIndices.length * 3 !== geometry.indices.length ||
		ranges.reduce((count, range) => count + range.indexCount, 0) !==
			renderableIndexCount
	) {
		throw new Error(
			`EnvCell ${cell.id} shell material range accounting failed.`,
		);
	}
	return ranges.map((range) => ({
		indexStart: range.indexStart,
		indexCount: range.indexCount,
		material: range.material,
		ordering: range.ordering,
	}));
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
	landblockId: LandblockId,
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

function objectGeometry(
	geometry: ResolvedGeometry,
	bakedLight: Float32Array | null,
): ObjectGeometryData {
	return {
		kind: "object",
		positions: geometry.positions,
		normals: geometry.normals,
		textureCoordinates: geometry.textureCoordinates,
		indices: geometry.indices,
		bakedLight,
	};
}

function apertureGeometry(
	landblockId: LandblockId,
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
