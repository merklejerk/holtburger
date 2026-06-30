import type {
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
} from "../../static/contracts";
import {
	createEnvCellPortalProjectionRoot,
	createStaticPortalProjection,
	createStaticPortalProjectionSourceKey,
} from "../../static/portal-graphs";
import type { CachedEnvCellPortalProjection } from "./static-query-state";

/** Cache for portal projections keyed by landblock and start env-cell root. */
export class EnvCellPortalProjectionCache {
	readonly #cacheByRootKey = new Map<string, CachedEnvCellPortalProjection>();
	readonly #loggedProjectionDiagnosticsByKey = new Map<string, string>();

	clear(): void {
		this.#cacheByRootKey.clear();
		this.#loggedProjectionDiagnosticsByKey.clear();
	}

	invalidate(landblockIds: ReadonlySet<number>): void {
		for (const cacheKey of this.#cacheByRootKey.keys()) {
			const landblockId =
				parseEnvCellPortalProjectionCacheKeyLandblockId(cacheKey);
			if (landblockId !== null && landblockIds.has(landblockId)) {
				this.#cacheByRootKey.delete(cacheKey);
				this.#loggedProjectionDiagnosticsByKey.delete(cacheKey);
			}
		}
	}

	invalidateLandblock(landblockId: number): void {
		this.invalidate(new Set([landblockId >>> 0]));
	}

	query(options: {
		readonly landblockId: number;
		readonly portalApertureResources: readonly StaticPortalApertureResource[];
		readonly portalGraphs: readonly StaticPortalGraphRecord[];
		readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
		readonly startEnvCellId: number;
	}): StaticPortalProjectionRecord | null {
		const landblockId = options.landblockId >>> 0;
		const startEnvCellId = options.startEnvCellId >>> 0;
		const root = createEnvCellPortalProjectionRoot({
			envCellId: startEnvCellId,
			landblockId,
		});
		const sourceKey = createStaticPortalProjectionSourceKey({
			landblockId,
			portalApertureResources: options.portalApertureResources,
			portalGraphs: options.portalGraphs,
			portalInteriorRecords: options.portalInteriorRecords,
			root,
		});
		const cacheKey = createEnvCellPortalProjectionCacheKey({
			landblockId,
			startEnvCellId,
		});
		const cached = this.#cacheByRootKey.get(cacheKey);
		if (cached?.sourceKey === sourceKey) {
			return cached.projection;
		}
		const projection = createStaticPortalProjection({
			landblockId,
			portalApertureResources: options.portalApertureResources,
			portalGraphs: options.portalGraphs,
			portalInteriorRecords: options.portalInteriorRecords,
			root,
		});
		this.#cacheByRootKey.set(cacheKey, {
			projection,
			sourceKey,
		});
		this.#logProjectionDiagnostics({
			cacheKey,
			landblockId,
			portalApertureResources: options.portalApertureResources,
			portalGraphs: options.portalGraphs,
			portalInteriorRecords: options.portalInteriorRecords,
			projection,
			startEnvCellId,
		});
		return projection;
	}

	#logProjectionDiagnostics(options: {
		readonly cacheKey: string;
		readonly landblockId: number;
		readonly portalApertureResources: readonly StaticPortalApertureResource[];
		readonly portalGraphs: readonly StaticPortalGraphRecord[];
		readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
		readonly projection: StaticPortalProjectionRecord | null;
		readonly startEnvCellId: number;
	}): void {
		const summary = createEnvCellProjectionDiagnosticSummary(options);
		const signature = JSON.stringify(summary);
		if (
			this.#loggedProjectionDiagnosticsByKey.get(options.cacheKey) === signature
		) {
			return;
		}
		this.#loggedProjectionDiagnosticsByKey.set(options.cacheKey, signature);
		console.info("[holtburger-3d][portal-projection-diagnostic]", summary);
	}
}

function createEnvCellPortalProjectionCacheKey(options: {
	readonly landblockId: number;
	readonly startEnvCellId: number;
}): string {
	return `${options.landblockId >>> 0}:${options.startEnvCellId >>> 0}`;
}

function parseEnvCellPortalProjectionCacheKeyLandblockId(
	cacheKey: string,
): number | null {
	const [landblockIdPart] = cacheKey.split(":", 1);
	if (!landblockIdPart) {
		return null;
	}
	const landblockId = Number(landblockIdPart);
	return Number.isFinite(landblockId) ? landblockId >>> 0 : null;
}

function createEnvCellProjectionDiagnosticSummary(options: {
	readonly landblockId: number;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly projection: StaticPortalProjectionRecord | null;
	readonly startEnvCellId: number;
}) {
	const rootOutgoingGraphEdges = options.portalGraphs.flatMap((graph) =>
		graph.landblockId === options.landblockId
			? graph.edges.filter(
					(edge) =>
						edge.sceneCrossing?.kind === "env-cell-to-env-cell" &&
						edge.sceneCrossing.sourceEnvCellId === options.startEnvCellId,
				)
			: [],
	);
	const rootInteriorRecord = options.portalInteriorRecords
		.filter((record) => record.landblockId === options.landblockId)
		.flatMap((record) => record.envCells)
		.find((envCell) => envCell.envCellId === options.startEnvCellId);

	return {
		apertureResourceCount: options.portalApertureResources.length,
		envCellPortalApertureResourceRanges: options.portalApertureResources
			.filter((resource) => resource.sourceDomain === "env-cell-system")
			.reduce((count, resource) => count + resource.ranges.length, 0),
		landblockId: formatHex32(options.landblockId),
		portalGraphCount: options.portalGraphs.length,
		portalGraphEdgeCount: options.portalGraphs.reduce(
			(count, graph) => count + graph.edges.length,
			0,
		),
		portalInteriorRecordCount: options.portalInteriorRecords.length,
		projection: options.projection
			? {
					diagnostics: options.projection.diagnostics,
					edgeCount: options.projection.edges.length,
					incomingEdgesForRoot:
						options.projection.incomingEdges.find(
							(entry) => entry.targetEnvCellId === options.startEnvCellId,
						)?.edgeIds.length ?? 0,
					nodeCount: options.projection.nodes.length,
					renderLayers: options.projection.renderLayers.map((layer) => ({
						envCellCount: layer.envCellIds.length,
						renderLayer: layer.renderLayer,
					})),
					rootOutgoingProjectionEdges: options.projection.edges.filter(
						(edge) => edge.sourceEnvCellId === options.startEnvCellId,
					).length,
				}
			: null,
		rootEnvCellId: formatHex32(options.startEnvCellId),
		rootInterior: rootInteriorRecord
			? {
					portalApertureCount: rootInteriorRecord.portalApertures.length,
					portalCount: rootInteriorRecord.portals.length,
					seenOutside: rootInteriorRecord.seenOutside ?? null,
				}
			: null,
		rootOutgoingGraphEdgeCount: rootOutgoingGraphEdges.length,
		rootOutgoingGraphEdges: rootOutgoingGraphEdges.map((edge) => ({
			linkId: edge.linkId,
			polygonId: edge.polygonId,
			sourceIndex: edge.sourceIndex,
			targetEnvCellId:
				edge.sceneCrossing?.kind === "env-cell-to-env-cell"
					? formatHex32(edge.sceneCrossing.targetEnvCellId)
					: null,
		})),
	};
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
