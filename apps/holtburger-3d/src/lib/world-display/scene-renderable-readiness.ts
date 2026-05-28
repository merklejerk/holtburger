import type { AssetChannelState } from "../assets/types";
import {
	deriveStaticRenderableReadinessModel,
	type StaticRenderableReadinessCommitPolicy,
	type StaticRenderableReadinessStatus,
} from "./static-renderable-readiness";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

type SceneRenderableFamily =
	| "terrain"
	| "structured-interior"
	| "static"
	| "portal";

type SceneRenderableDependencyClass =
	| "render-chunk"
	| "geometry"
	| "material-plan"
	| "surface-texture"
	| "source"
	| "setup-appearance"
	| "gfx-geometry"
	| "portal-aperture";

interface SceneRenderableReadinessRecord<TItem = unknown> {
	key: string;
	family: SceneRenderableFamily;
	status: StaticRenderableReadinessStatus;
	dependencyClass: SceneRenderableDependencyClass;
	item: TItem | null;
	assetId: string | null;
	reason: string;
	committed: boolean;
}

interface SceneRenderableReadinessMetrics {
	pendingCount: number;
	resolvedCount: number;
	fallbackResolvedCount: number;
	failedCount: number;
	committedTerrainTileCount: number;
	committedStructuredInteriorCellCount: number;
	committedStaticPartCount: number;
	committedPortalCandidateCount: number;
	reasonSamples: string[];
}

export type SceneRenderableReadinessCommitPolicy =
	StaticRenderableReadinessCommitPolicy;

export interface SceneRenderableReadinessModel {
	records: SceneRenderableReadinessRecord[];
	committedTerrainScene: TerrainSceneModel;
	committedStructuredInteriorScene: StructuredInteriorSceneModel;
	committedStaticRenderableScene: StaticRenderableSceneModel;
	committedTransitionPortalModel: TransitionPortalCandidateModel;
	metrics: SceneRenderableReadinessMetrics;
}

const READINESS_REASON_SAMPLE_LIMIT = 16;

export function deriveSceneRenderableReadinessModel({
	assetState,
	commitPolicy = "resolved-only",
	terrainScene,
	structuredInteriorScene,
	staticRenderableScene,
	transitionPortalModel,
}: {
	assetState: AssetChannelState;
	commitPolicy?: SceneRenderableReadinessCommitPolicy;
	terrainScene: TerrainSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
}): SceneRenderableReadinessModel {
	const terrainRecords = terrainScene.tiles.map((tile) =>
		deriveTerrainTileRecord(tile, commitPolicy),
	);
	const committedTerrainScene = filterTerrainScene(
		terrainScene,
		committedItems(terrainRecords),
	);
	const structuredInteriorRecords: SceneRenderableReadinessRecord<StructuredInteriorCell>[] =
		[
			...deriveStructuredInteriorMissingRecords(structuredInteriorScene),
			...structuredInteriorScene.cells.map(deriveStructuredInteriorCellRecord),
		];
	const committedStructuredInteriorScene = filterStructuredInteriorScene(
		structuredInteriorScene,
		committedItems(structuredInteriorRecords),
	);
	const staticReadiness = deriveStaticRenderableReadinessModel({
		assetState,
		commitPolicy,
		scene: staticRenderableScene,
	});
	const staticRecords: SceneRenderableReadinessRecord[] =
		staticReadiness.records.map((record) => ({
			key: `static/${record.key}`,
			family: "static",
			status: record.status,
			dependencyClass: record.dependencyClass,
			item: record.part,
			assetId: record.assetId,
			reason: record.reason,
			committed: record.committed,
		}));
	const portalRecords = derivePortalReadinessRecords(transitionPortalModel);
	const committedPortalCandidateIds = new Set(
		portalRecords
			.filter(
				(
					record,
				): record is SceneRenderableReadinessRecord<TransitionPortalCandidate> & {
					item: TransitionPortalCandidate;
				} => record.committed && record.item !== null,
			)
			.map((record) => record.item.id),
	);
	const committedTransitionPortalModel = {
		...transitionPortalModel,
		candidates: transitionPortalModel.candidates.filter((candidate) =>
			committedPortalCandidateIds.has(candidate.id),
		),
	};
	const records: SceneRenderableReadinessRecord[] = [
		...terrainRecords,
		...structuredInteriorRecords,
		...staticRecords,
		...portalRecords,
	];

	return {
		records,
		committedTerrainScene,
		committedStructuredInteriorScene,
		committedStaticRenderableScene: staticReadiness.committedScene,
		committedTransitionPortalModel,
		metrics: deriveReadinessMetrics({
			records,
			committedTerrainTileCount: committedTerrainScene.tiles.length,
			committedStructuredInteriorCellCount:
				committedStructuredInteriorScene.cells.length,
			committedStaticPartCount: staticReadiness.committedScene.parts.length,
			committedPortalCandidateCount:
				committedTransitionPortalModel.candidates.length,
		}),
	};
}

function deriveTerrainTileRecord(
	tile: TerrainSceneTile,
	commitPolicy: SceneRenderableReadinessCommitPolicy,
): SceneRenderableReadinessRecord<TerrainSceneTile> {
	if (tile.mesh.vertices.length === 0 || tile.mesh.triangles.length === 0) {
		return createRecord({
			key: `terrain/${tile.assetId}`,
			family: "terrain",
			status: "failed",
			dependencyClass: "geometry",
			commitPolicy,
			item: tile,
			assetId: tile.assetId,
			reason: "terrain tile has no renderable triangles",
		});
	}

	if (!tile.materialResources) {
		return createRecord({
			key: `terrain/${tile.assetId}`,
			family: "terrain",
			status: "fallback-resolved",
			dependencyClass: "material-plan",
			commitPolicy,
			item: tile,
			assetId: tile.assetId,
			reason: "terrain material plan is absent; fallback material is valid",
		});
	}

	if (tile.materialResources.status !== "ready") {
		return createRecord({
			key: `terrain/${tile.assetId}`,
			family: "terrain",
			status: "fallback-resolved",
			dependencyClass: terrainMaterialDependencyClass(tile),
			commitPolicy,
			item: tile,
			assetId: terrainMaterialDependencyAssetId(tile),
			reason: `terrain material plan is ${tile.materialResources.status}; fallback material is valid`,
		});
	}

	return createRecord({
		key: `terrain/${tile.assetId}`,
		family: "terrain",
		status: "resolved",
		dependencyClass: "geometry",
		commitPolicy,
		item: tile,
		assetId: tile.assetId,
		reason: "terrain geometry and material plan are prepared",
	});
}

function terrainMaterialDependencyClass(
	tile: TerrainSceneTile,
): "material-plan" | "surface-texture" {
	return tile.materialResources.status === "missing-table"
		? "material-plan"
		: "surface-texture";
}

function terrainMaterialDependencyAssetId(tile: TerrainSceneTile): string {
	return (
		tile.materialResources.missingSurfaceTextureAssetIds[0] ??
		tile.materialResources.missingRenderSurfaceAssetIds[0] ??
		tile.materialResources.unsupportedRenderSurfaceAssetIds[0] ??
		tile.materialResources.terrainMaterialAssetId
	);
}

function deriveStructuredInteriorMissingRecords(
	scene: StructuredInteriorSceneModel,
): SceneRenderableReadinessRecord<StructuredInteriorCell>[] {
	return [
		...scene.missingEnvCellAssetIds.map((assetId) =>
			createRecord<StructuredInteriorCell>({
				key: `structured-interior/missing-env-cell/${assetId}`,
				family: "structured-interior",
				status: "pending",
				dependencyClass: "source",
				item: null,
				assetId,
				reason: "env cell asset is not prepared",
			}),
		),
		...scene.missingInteriorGeometryAssetIds.map((assetId) =>
			createRecord<StructuredInteriorCell>({
				key: `structured-interior/missing-geometry/${assetId}`,
				family: "structured-interior",
				status: "pending",
				dependencyClass: "geometry",
				item: null,
				assetId,
				reason: "interior render geometry asset is not prepared",
			}),
		),
		...scene.missingCellStructureKeys.map((assetId) =>
			createRecord<StructuredInteriorCell>({
				key: `structured-interior/missing-cell-structure/${assetId}`,
				family: "structured-interior",
				status: "fallback-resolved",
				dependencyClass: "source",
				item: null,
				assetId,
				reason: "cell structure is not prepared; prepared env-cell geometry remains renderable",
			}),
		),
	];
}

function deriveStructuredInteriorCellRecord(
	cell: StructuredInteriorCell,
): SceneRenderableReadinessRecord<StructuredInteriorCell> {
	if (
		cell.renderGeometry.vertexCount === 0 ||
		cell.renderGeometry.triangleCount === 0
	) {
		return createRecord({
			key: `structured-interior/${cell.renderKey}`,
			family: "structured-interior",
			status: "failed",
			dependencyClass: "geometry",
			item: cell,
			assetId: null,
			reason: "structured interior cell has no renderable triangles",
		});
	}

	return createRecord({
		key: `structured-interior/${cell.renderKey}`,
		family: "structured-interior",
		status: "resolved",
		dependencyClass: "geometry",
		item: cell,
		assetId: null,
		reason: "structured interior geometry is prepared",
	});
}

function derivePortalReadinessRecords(
	model: TransitionPortalCandidateModel,
): SceneRenderableReadinessRecord<TransitionPortalCandidate>[] {
	const records = model.candidates.map((candidate) =>
		createRecord<TransitionPortalCandidate>({
			key: `portal/${candidate.id}`,
			family: "portal",
			status:
				candidate.aperture.points.length >= 3 ? "resolved" : "failed",
			dependencyClass: "portal-aperture",
			item: candidate,
			assetId: null,
			reason:
				candidate.aperture.points.length >= 3
					? "portal aperture is prepared"
					: "portal aperture has fewer than three points",
		}),
	);

	for (const [reason, count] of [
		["missing aperture", model.diagnostics.skippedMissingApertureCount],
		["missing portal polygon", model.diagnostics.skippedMissingPolygonCount],
	] as const) {
		if (count > 0) {
			records.push(
				createRecord<TransitionPortalCandidate>({
					key: `portal/no-render/${reason}`,
					family: "portal",
					status: "fallback-resolved",
					dependencyClass: "portal-aperture",
					item: null,
					assetId: null,
					reason: `${count} portal candidate${count === 1 ? "" : "s"} skipped for ${reason}`,
				}),
			);
		}
	}

	return records;
}

function filterTerrainScene(
	scene: TerrainSceneModel,
	includeTile: (tile: TerrainSceneTile) => boolean,
): TerrainSceneModel {
	return { ...scene, tiles: scene.tiles.filter(includeTile) };
}

function filterStructuredInteriorScene(
	scene: StructuredInteriorSceneModel,
	includeCell: (cell: StructuredInteriorCell) => boolean,
): StructuredInteriorSceneModel {
	return { ...scene, cells: scene.cells.filter(includeCell) };
}

function committedItems<TItem>(
	records: readonly SceneRenderableReadinessRecord<TItem>[],
): (item: TItem) => boolean {
	const items = new Set(
		records
			.filter((record) => record.committed && record.item !== null)
			.map((record) => record.item as TItem),
	);
	return (item) => items.has(item);
}

function createRecord<TItem>({
	key,
	family,
	status,
	dependencyClass,
	commitPolicy = "resolved-only",
	item,
	assetId,
	reason,
}: {
	key: string;
	family: SceneRenderableFamily;
	status: StaticRenderableReadinessStatus;
	dependencyClass: SceneRenderableDependencyClass;
	commitPolicy?: SceneRenderableReadinessCommitPolicy;
	item: TItem | null;
	assetId: string | null;
	reason: string;
}): SceneRenderableReadinessRecord<TItem> {
	return {
		key,
		family,
		status,
		dependencyClass,
		item,
		assetId,
		reason,
		committed: isCommittedStatus(status, commitPolicy),
	};
}

function isCommittedStatus(
	status: StaticRenderableReadinessStatus,
	commitPolicy: SceneRenderableReadinessCommitPolicy,
): boolean {
	return (
		status === "resolved" ||
		(commitPolicy === "allow-fallback" && status === "fallback-resolved")
	);
}

function deriveReadinessMetrics({
	records,
	committedTerrainTileCount,
	committedStructuredInteriorCellCount,
	committedStaticPartCount,
	committedPortalCandidateCount,
}: {
	records: readonly SceneRenderableReadinessRecord[];
	committedTerrainTileCount: number;
	committedStructuredInteriorCellCount: number;
	committedStaticPartCount: number;
	committedPortalCandidateCount: number;
}): SceneRenderableReadinessMetrics {
	return {
		pendingCount: records.filter((record) => record.status === "pending")
			.length,
		resolvedCount: records.filter((record) => record.status === "resolved")
			.length,
		fallbackResolvedCount: records.filter(
			(record) => record.status === "fallback-resolved",
		).length,
		failedCount: records.filter((record) => record.status === "failed").length,
		committedTerrainTileCount,
		committedStructuredInteriorCellCount,
		committedStaticPartCount,
		committedPortalCandidateCount,
		reasonSamples: records
			.filter((record) => record.status !== "resolved")
			.slice(0, READINESS_REASON_SAMPLE_LIMIT)
			.map((record) =>
				record.assetId
					? `${record.family}:${record.dependencyClass}:${record.assetId}: ${record.reason}`
					: `${record.family}:${record.dependencyClass}: ${record.reason}`,
			),
	};
}
