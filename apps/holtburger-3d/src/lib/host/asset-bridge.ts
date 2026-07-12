import type {
	HostAabbDto,
	HostEnvCellLayerSourceDto,
	HostGeometryDto,
	HostLandblockLayerSourceDto,
	HostMaterialDto,
	HostMatrix4Dto,
	HostMotionGraphDto,
	HostMotionSequenceDto,
	HostObjectAppearanceDto,
	HostObjectLayerSourceDto,
	HostObjectPresentationDto,
	HostObjectResidentDto,
	HostVec3Dto,
	ResolveLandblockLayerRequestDto,
} from "./contracts";
import type { LandblockId } from "../game/game-types";
import { AABB3, Mat4, Vec3 } from "../game/math/types";
import type {
	ResolvedCellStructure,
	ResolvedEnvCellLayerSource,
	ResolvedGeometry,
	ResolvedLandblockLayerSource,
	ResolvedMaterial,
	ResolvedMotionGraph,
	ResolvedMotionSequence,
	ResolvedObjectAppearance,
	ResolvedObjectLayerSource,
	ResolvedObjectPresentation,
	ResolvedObjectResident,
} from "../game/presentation/types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../game/runtime/scene-interest";

/** Frontend-facing bridge from host content assets to normalized game sources. */
export interface HostAssetBridge {
	resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource>;
}

/** Tauri implementation of the host asset bridge. */
export class TauriHostAssetBridge implements HostAssetBridge {
	protected constructor() {}

	static build(): TauriHostAssetBridge {
		return new TauriHostAssetBridge();
	}

	async resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource> {
		const { invoke } = await import("@tauri-apps/api/core");
		const request: ResolveLandblockLayerRequestDto = {
			landblockId: layer.id,
			layer: layer.layer,
		};
		const dto = await invoke<HostLandblockLayerSourceDto>(
			"resolve_landblock_layer",
			{ request },
		);
		return normalizeHostLandblockLayer(dto, layer);
	}
}

/** Normalize one host DTO and verify it answers the requested layer. */
export function normalizeHostLandblockLayer(
	dto: HostLandblockLayerSourceDto,
	requested: LandblockIdLayer,
): ResolvedLandblockLayerSource {
	if (dto.landblockId !== requested.id || dto.kind !== requested.layer) {
		throw new Error(
			`Host returned ${dto.landblockId}/${dto.kind} for ${requested.id}/${requested.layer}.`,
		);
	}

	switch (dto.kind) {
		case "terrain":
			return {
				featureIndices: Uint8Array.from(dto.featureIndices),
				features: dto.features.map((feature) => ({
					colorTextureIds: feature.colorTextureIds,
					detailTextureId: feature.detailTextureId,
					roadMaskTextureId: feature.roadMaskTextureId,
				})),
				heights: Float32Array.from(dto.heights),
				kind: LandblockLayerKind.Terrain,
				landblockId: dto.landblockId,
			};
		case "buildings":
		case "objects":
		case "generated":
			return normalizeObjectLayer(dto);
		case "env-cells":
			return normalizeEnvCellLayer(dto);
	}
}

function normalizeObjectLayer(
	dto: HostObjectLayerSourceDto,
): ResolvedObjectLayerSource {
	const presentations = normalizePresentationMap(dto.presentations);
	const residents = dto.residents.map((resident) =>
		normalizeObjectResident(resident, dto.landblockId, presentations),
	);
	return {
		buildingTransitions: dto.buildingTransitions.map((transition) => ({
			bounds: normalizeAabb(transition.bounds),
			buildingResidentId: transition.buildingResidentId,
			id: transition.id,
			targetEnvCellId: transition.targetEnvCellId,
		})),
		dynamicResidents: residents.filter(
			(_, index) => dto.residents[index]?.activation === "dynamic",
		),
		kind: normalizeObjectLayerKind(dto.kind),
		landblockId: dto.landblockId,
		staticResidents: residents.filter(
			(_, index) => dto.residents[index]?.activation === "static",
		),
	};
}

function normalizeEnvCellLayer(
	dto: HostEnvCellLayerSourceDto,
): ResolvedEnvCellLayerSource {
	const presentations = normalizePresentationMap(dto.presentations);
	const structures = new Map<string, ResolvedCellStructure>(
		dto.structures.map((structure) => {
			return [
				structure.id,
				{
					cellBsp: structure.cellBsp,
					drawingBsp: structure.drawingBsp,
					geometry: normalizeGeometry(structure.geometry),
					id: structure.id,
					physicsBsp: structure.physicsBsp,
					portalPolygonIndices: structure.portalPolygonIndices,
					surfaceSlotCount: structure.surfaceSlotCount,
				},
			];
		}),
	);
	const dynamicResidents: ResolvedObjectResident[] = [];
	const cells = dto.cells.map((cell) => {
		const structure = structures.get(cell.structureId);
		if (!structure) {
			throw new Error(
				`Env cell ${cell.id} references missing structure ${cell.structureId}.`,
			);
		}
		const embedded = cell.embeddedResidents.map((resident) =>
			normalizeObjectResident(resident, dto.landblockId, presentations),
		);
		dynamicResidents.push(
			...embedded.filter(
				(_, index) => cell.embeddedResidents[index]?.activation === "dynamic",
			),
		);
		return {
			bounds: normalizeAabb(cell.bounds),
			embeddedStatics: embedded.filter(
				(_, index) => cell.embeddedResidents[index]?.activation === "static",
			),
			id: cell.id,
			materials: cell.materials.map(normalizeMaterial),
			placement: {
				envCellId: cell.id,
				landblockId: dto.landblockId,
				localTransform: normalizeMatrix(cell.placement),
			},
			portals: cell.portals.map((portal) => ({
				bounds: portal.bounds ? normalizeAabb(portal.bounds) : null,
				id: portal.id,
				polygonIndex: portal.polygonIndex,
				targetEnvCellId: portal.targetEnvCellId,
				targetPortalId: portal.targetPortalId,
			})),
			structure,
		};
	});
	return {
		cells,
		dynamicResidents,
		kind: LandblockLayerKind.EnvCells,
		landblockId: dto.landblockId,
	};
}

function normalizePresentationMap(
	dtos: readonly HostObjectPresentationDto[],
): ReadonlyMap<string, ResolvedObjectPresentation> {
	return new Map(dtos.map((dto) => [dto.id, normalizePresentation(dto)]));
}

function normalizePresentation(
	dto: HostObjectPresentationDto,
): ResolvedObjectPresentation {
	const geometry = new Map(
		dto.geometry.map((entry) => [entry.id, normalizeGeometry(entry)]),
	);
	const materials = new Map(
		dto.materials.map((entry) => [entry.id, normalizeMaterial(entry)]),
	);
	return {
		effects: dto.effects,
		id: `presentation:${dto.id}`,
		motion: dto.motion ? normalizeMotionGraph(dto.motion) : null,
		parts: dto.parts.map((part) => ({
			defaultScale: normalizeVec3(part.defaultScale),
			geometry: requireMapEntry(geometry, part.geometryId, "geometry"),
			materials: part.materialIds.map((materialId) =>
				requireMapEntry(materials, materialId, "material"),
			),
			parentPartIndex: part.parentPartIndex,
			partIndex: part.partIndex,
		})),
		placementPoses: new Map(
			dto.placementPoses.map((pose) => [
				pose.placementId,
				{
					partTransforms: pose.partTransforms.map(normalizeMatrix),
					placementId: pose.placementId,
				},
			]),
		),
		selectionBounds: dto.selectionBounds
			? normalizeAabb(dto.selectionBounds)
			: null,
		sortingBounds: dto.sortingBounds ? normalizeAabb(dto.sortingBounds) : null,
		sourceAssetId: dto.sourceAssetId,
	};
}

function normalizeObjectResident(
	dto: HostObjectResidentDto,
	landblockId: LandblockId,
	presentations: ReadonlyMap<string, ResolvedObjectPresentation>,
): ResolvedObjectResident {
	return {
		appearance: dto.appearance ? normalizeAppearance(dto.appearance) : null,
		bounds: dto.bounds ? normalizeAabb(dto.bounds) : null,
		id: dto.id,
		placement: {
			envCellId: dto.envCellId,
			landblockId,
			localTransform: normalizeMatrix(dto.placement),
		},
		presentation: requireMapEntry(
			presentations,
			dto.presentationId,
			"presentation",
		),
		scale: normalizeVec3(dto.scale),
	};
}

function normalizeAppearance(
	dto: HostObjectAppearanceDto,
): ResolvedObjectAppearance {
	return {
		paletteId: dto.paletteId,
		partChanges: dto.partChanges.map((change) => ({
			geometryId: `geometry:${change.geometryId}`,
			partIndex: change.partIndex,
		})),
		subPalettes: dto.subPalettes,
		textureChanges: dto.textureChanges,
	};
}

function normalizeMotionGraph(dto: HostMotionGraphDto): ResolvedMotionGraph {
	return {
		cycles: normalizeMotionSequences(dto.cycles),
		defaultStyle: dto.defaultStyle,
		modifiers: normalizeMotionSequences(dto.modifiers),
		motionTableId: dto.motionTableId,
		styleDefaults: new Map(
			dto.styleDefaults.map(({ motion, style }) => [style, motion]),
		),
		transitions: normalizeMotionSequences(dto.transitions),
	};
}

function normalizeMotionSequences(
	dtos: readonly HostMotionSequenceDto[],
): ReadonlyMap<string, ResolvedMotionSequence> {
	return new Map(
		dtos.map((dto) => [
			dto.key,
			{
				angularVelocity: dto.angularVelocity
					? normalizeVec3(dto.angularVelocity)
					: null,
				clips: dto.clips,
				key: dto.key,
				velocity: dto.velocity ? normalizeVec3(dto.velocity) : null,
			},
		]),
	);
}

function normalizeGeometry(dto: HostGeometryDto): ResolvedGeometry {
	return {
		bounds: dto.bounds ? normalizeAabb(dto.bounds) : null,
		id: `geometry:${dto.id}`,
		indices: Uint32Array.from(dto.indices),
		materialSlotIndices: Uint16Array.from(dto.materialSlotIndices),
		normals: Float32Array.from(dto.normals),
		positions: Float32Array.from(dto.positions),
		textureCoordinates: Float32Array.from(dto.textureCoordinates),
	};
}

function normalizeMaterial(dto: HostMaterialDto): ResolvedMaterial {
	if (dto.kind === "solid-color") {
		return { color: dto.color, id: `material:${dto.id}`, kind: dto.kind };
	}
	return {
		colorTextureId: dto.colorTextureId,
		detailTextureId: dto.detailTextureId,
		id: `material:${dto.id}`,
		kind: dto.kind,
		paletteTextureId: dto.paletteTextureId,
	};
}

function normalizeObjectLayerKind(
	kind: HostObjectLayerSourceDto["kind"],
): ResolvedObjectLayerSource["kind"] {
	switch (kind) {
		case "buildings":
			return LandblockLayerKind.Buildings;
		case "objects":
			return LandblockLayerKind.Objects;
		case "generated":
			return LandblockLayerKind.Generated;
	}
}

function normalizeMatrix(values: HostMatrix4Dto): Mat4 {
	if (values.length !== 16) {
		throw new Error(
			`Host matrix contains ${values.length} values; expected 16.`,
		);
	}
	return new Mat4(
		values[0]!,
		values[1]!,
		values[2]!,
		values[3]!,
		values[4]!,
		values[5]!,
		values[6]!,
		values[7]!,
		values[8]!,
		values[9]!,
		values[10]!,
		values[11]!,
		values[12]!,
		values[13]!,
		values[14]!,
		values[15]!,
	);
}

function normalizeVec3(value: HostVec3Dto): Vec3 {
	return new Vec3(value.x, value.y, value.z);
}

function normalizeAabb(value: HostAabbDto): AABB3 {
	return new AABB3(normalizeVec3(value.min), normalizeVec3(value.max));
}

function requireMapEntry<TKey, TValue>(
	map: ReadonlyMap<TKey, TValue>,
	key: TKey,
	kind: string,
): TValue {
	const value = map.get(key);
	if (value === undefined) {
		throw new Error(`Host source references missing ${kind} ${String(key)}.`);
	}
	return value;
}
