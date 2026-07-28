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
import type {
	ObjectGeometryData,
	PortalGeometryData,
} from "../renderer/geometry";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ScenePlacement, SceneScope } from "../scene";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import { addAssetTextureFacts } from "../textures/texture-facts";
import type { StaticObjectMaterialBinding } from "./artifacts";
import { resolveStaticTriangleMaterial } from "./static-material-binding";
import { collectStaticObjectTextureDependencies } from "./static-object-texture-inputs";

/** One contiguous CellStruct shell range with a complete renderer-neutral binding. */
interface EnvCellShellMaterialRange {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
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
	readonly deferredResidents: readonly ResolvedObjectResident[];
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
	const shellGeometrySources = new Map<ObjectGeometryKey, ResolvedGeometry>();
	const shellTextureRequirements = new Map<AssetTextureKey, AssetTextureFact>();
	const shellMaterialIds = new Set<string>();
	const shells: EnvCellShellMaterializationPlan[] = [];
	const scopes: EnvCellScopeMaterializationPlan[] = [];
	const residentJobs: EnvCellResidentMaterializationJob[] = [];
	const deferredResidents: ResolvedObjectResident[] = [];
	let expectedResidentCount = 0;
	let plannedStaticResidentCount = 0;
	let shellMaterialRangeCount = 0;

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
		const geometryKey = createObjectGeometryKey(cell.structure.geometry.id);
		const existingGeometry = shellGeometrySources.get(geometryKey);
		if (existingGeometry && existingGeometry !== cell.structure.geometry) {
			throw new Error(
				`Shared CellStruct geometry ${cell.structure.geometry.id} has divergent buffers.`,
			);
		}
		if (!existingGeometry) {
			shellGeometrySources.set(geometryKey, cell.structure.geometry);
			shellGeometries.set(geometryKey, {
				key: geometryKey,
				geometry: objectGeometry(cell.structure.geometry),
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
		});

		const residents = cell.residents.map(resolveResident);
		expectedResidentCount += residents.length;
		const classified = classifyObjectResidents(residents);
		plannedStaticResidentCount += classified.staticResidents.length;
		deferredResidents.push(...classified.dynamicResidents);
		const residentSource: ResolvedEnvCellStaticObjectSource = {
			kind: LandblockLayerKind.EnvCells,
			landblockId: source.landblockId,
			envCellId: cell.id,
			staticResidents: classified.staticResidents,
			dynamicResidents: classified.dynamicResidents,
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
		deferredResidents,
		diagnostics: {
			expectedCellCount: source.cells.length,
			shellCount: shells.length,
			apertureCount: source.portalApertures.length,
			crossingCount: source.portalCrossings.length,
			expectedResidentCount,
			plannedStaticResidentCount,
			defaultAnimatedResidentCount: deferredResidents.length,
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
	for (
		let triangle = 0;
		triangle < geometry.materialSlotIndices.length;
		triangle += 1
	) {
		const resolved = resolveStaticTriangleMaterial({
			detailRole: "environment",
			geometry,
			materials: cell.materials,
			sourceLabel: `EnvCell ${cell.id} shell`,
			triangle,
		});
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
			geometry.indices.length
	) {
		throw new Error(`EnvCell ${cell.id} shell material ranges are incomplete.`);
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
		id: resident.id,
		presentation: resident.presentation,
		placement: resident.placement,
		scale: resident.scale,
		localBounds: resident.localBounds,
		appearance: resident.appearance,
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

function objectGeometry(geometry: ResolvedGeometry): ObjectGeometryData {
	return {
		kind: "object",
		positions: geometry.positions,
		normals: geometry.normals,
		textureCoordinates: geometry.textureCoordinates,
		indices: geometry.indices,
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
