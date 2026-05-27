import type {
	AssetChannelState,
	PreparedRenderSurfacePayload,
	PreparedTerrainMaterialTablePayload,
	PreparedTerrainQuad,
} from "../assets/types";
import { formatHex32, formatTerrainMaterialAssetId } from "../landblocks";
import { isIndexedTextureFormat } from "./indexed-texture-resources";
import {
	isSupportedCompressedFormat,
	isSupportedDirectColorFormat,
} from "./render-surface-texture-resources";

type TerrainMaterialResourceStatus =
	| "ready"
	| "missing-table"
	| "missing-texture-resources"
	| "unsupported-render-surface";

export interface TerrainMaterialResourcePlan {
	kind: "terrain-material-resource-plan";
	regionNumber: number;
	terrainMaterialAssetId: string;
	status: TerrainMaterialResourceStatus;
	signature: string;
	terrainTypeCount: number;
	terrainAlphaMapCount: number;
	roadAlphaMapCount: number;
	uniquePcodeCount: number;
	referencedTerrainCodes: number[];
	missingTerrainTypes: number[];
	missingSurfaceTextureAssetIds: string[];
	missingRenderSurfaceAssetIds: string[];
	unsupportedRenderSurfaceAssetIds: string[];
	hasTerrainAlphaMaps: boolean;
	hasRoadAlphaMaps: boolean;
	diagnostics: string[];
}

export interface BuildTerrainMaterialResourcePlanOptions {
	assetState: AssetChannelState;
	regionNumber: number;
	quads: readonly PreparedTerrainQuad[];
}

export function buildTerrainMaterialResourcePlan(
	options: BuildTerrainMaterialResourcePlanOptions,
): TerrainMaterialResourcePlan {
	const terrainMaterialAssetId = formatTerrainMaterialAssetId(
		options.regionNumber,
	);
	const table = getPreparedTerrainMaterialTable(
		options.assetState,
		terrainMaterialAssetId,
	);
	const pcodeSummary = summarizeTerrainPcodes(options.quads);

	if (!table) {
		return {
			kind: "terrain-material-resource-plan",
			regionNumber: options.regionNumber,
			terrainMaterialAssetId,
			status: "missing-table",
			signature: `terrain:${options.regionNumber}:missing-table:p=${pcodeSummary.uniquePcodeCount}`,
			terrainTypeCount: 0,
			terrainAlphaMapCount: 0,
			roadAlphaMapCount: 0,
			uniquePcodeCount: pcodeSummary.uniquePcodeCount,
			referencedTerrainCodes: pcodeSummary.referencedTerrainCodes,
			missingTerrainTypes: pcodeSummary.referencedTerrainCodes,
			missingSurfaceTextureAssetIds: [],
			missingRenderSurfaceAssetIds: [],
			unsupportedRenderSurfaceAssetIds: [],
			hasTerrainAlphaMaps: false,
			hasRoadAlphaMaps: false,
			diagnostics: [
				`Missing terrain material table ${terrainMaterialAssetId}.`,
			],
		};
	}

	const missingTerrainTypes = findMissingTerrainTypes(
		table,
		pcodeSummary.referencedTerrainCodes,
	);
	const surfaceTextureReadiness = summarizeSurfaceTextureReadiness(
		options.assetState,
		collectTerrainBlendSurfaceTextureAssetIds(table),
	);
	const unsupportedRenderSurfaceAssetIds = findUnsupportedRenderSurfaceAssetIds(
		options.assetState,
		surfaceTextureReadiness.readyRenderSurfaceAssetIds,
	);
	const diagnostics = buildDiagnostics({
		table,
		missingTerrainTypes,
		missingSurfaceTextureAssetIds:
			surfaceTextureReadiness.missingSurfaceTextureAssetIds,
		missingRenderSurfaceAssetIds:
			surfaceTextureReadiness.missingRenderSurfaceAssetIds,
		unsupportedRenderSurfaceAssetIds,
	});
	const status = deriveStatus({
		missingSurfaceTextureAssetIds:
			surfaceTextureReadiness.missingSurfaceTextureAssetIds,
		missingRenderSurfaceAssetIds:
			surfaceTextureReadiness.missingRenderSurfaceAssetIds,
		unsupportedRenderSurfaceAssetIds,
	});

	return {
		kind: "terrain-material-resource-plan",
		regionNumber: options.regionNumber,
		terrainMaterialAssetId,
		status,
		signature: buildTerrainMaterialSignature({
			table,
			pcodeSummary,
			status,
			missingTerrainTypes,
			missingSurfaceTextureAssetIds:
				surfaceTextureReadiness.missingSurfaceTextureAssetIds,
			missingRenderSurfaceAssetIds:
				surfaceTextureReadiness.missingRenderSurfaceAssetIds,
			unsupportedRenderSurfaceAssetIds,
		}),
		terrainTypeCount: table.terrainTypes.length,
		terrainAlphaMapCount: table.terrainAlphaMaps.length,
		roadAlphaMapCount: table.roadAlphaMaps.length,
		uniquePcodeCount: pcodeSummary.uniquePcodeCount,
		referencedTerrainCodes: pcodeSummary.referencedTerrainCodes,
		missingTerrainTypes,
		missingSurfaceTextureAssetIds:
			surfaceTextureReadiness.missingSurfaceTextureAssetIds,
		missingRenderSurfaceAssetIds:
			surfaceTextureReadiness.missingRenderSurfaceAssetIds,
		unsupportedRenderSurfaceAssetIds,
		hasTerrainAlphaMaps: table.terrainAlphaMaps.length > 0,
		hasRoadAlphaMaps: table.roadAlphaMaps.length > 0,
		diagnostics,
	};
}

function collectTerrainBlendSurfaceTextureAssetIds(
	table: PreparedTerrainMaterialTablePayload,
): string[] {
	return uniqueSortedStrings([
		...table.terrainTypes.map((terrain) => terrain.textureAssetId),
		...table.terrainAlphaMaps.map((alpha) => alpha.alphaTextureAssetId),
		...table.roadAlphaMaps.flatMap((road) => [
			road.roadTextureAssetId,
			road.alphaTextureAssetId,
		]),
	]);
}

interface TerrainPcodeSummary {
	uniquePcodeCount: number;
	referencedTerrainCodes: number[];
}

function summarizeTerrainPcodes(
	quads: readonly PreparedTerrainQuad[],
): TerrainPcodeSummary {
	const pcodes = new Set<number>();
	const terrainCodes = new Set<number>();
	for (const quad of quads) {
		pcodes.add(quad.pcode);
		for (const code of quad.cornerTerrainCodes) {
			terrainCodes.add(code);
		}
	}
	return {
		uniquePcodeCount: pcodes.size,
		referencedTerrainCodes: [...terrainCodes].sort(compareNumbers),
	};
}

function getPreparedTerrainMaterialTable(
	assetState: AssetChannelState,
	assetId: string,
): PreparedTerrainMaterialTablePayload | null {
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "terrain-material" ? record.payload : null;
}

function findMissingTerrainTypes(
	table: PreparedTerrainMaterialTablePayload,
	referencedTerrainCodes: readonly number[],
): number[] {
	const knownTerrainTypes = new Set(
		table.terrainTypes.map((terrain) => terrain.terrainType),
	);
	return referencedTerrainCodes
		.filter((terrainCode) => !knownTerrainTypes.has(terrainCode))
		.sort(compareNumbers);
}

interface SurfaceTextureReadinessSummary {
	missingSurfaceTextureAssetIds: string[];
	missingRenderSurfaceAssetIds: string[];
	readyRenderSurfaceAssetIds: string[];
}

function summarizeSurfaceTextureReadiness(
	assetState: AssetChannelState,
	surfaceTextureAssetIds: readonly string[],
): SurfaceTextureReadinessSummary {
	const missingSurfaceTextureAssetIds: string[] = [];
	const missingRenderSurfaceAssetIds: string[] = [];
	const readyRenderSurfaceAssetIds: string[] = [];

	for (const assetId of surfaceTextureAssetIds) {
		const record = assetState.preparedByAssetId[assetId];
		if (record?.payload.kind !== "surface-texture") {
			missingSurfaceTextureAssetIds.push(assetId);
			continue;
		}
		const selectedRenderSurfaceId = record.payload.selectedRenderSurfaceId;
		if (selectedRenderSurfaceId === null) {
			missingRenderSurfaceAssetIds.push(`${assetId}:selected-source`);
			continue;
		}
		const renderSurfaceAssetId = formatRenderSurfaceAssetId(
			selectedRenderSurfaceId,
		);
		const renderSurfaceRecord =
			assetState.preparedByAssetId[renderSurfaceAssetId];
		if (renderSurfaceRecord?.payload.kind !== "render-surface") {
			missingRenderSurfaceAssetIds.push(renderSurfaceAssetId);
			continue;
		}
		readyRenderSurfaceAssetIds.push(renderSurfaceAssetId);
	}

	return {
		missingSurfaceTextureAssetIds:
			missingSurfaceTextureAssetIds.sort(compareStrings),
		missingRenderSurfaceAssetIds:
			missingRenderSurfaceAssetIds.sort(compareStrings),
		readyRenderSurfaceAssetIds: readyRenderSurfaceAssetIds.sort(compareStrings),
	};
}

function findUnsupportedRenderSurfaceAssetIds(
	assetState: AssetChannelState,
	renderSurfaceAssetIds: readonly string[],
): string[] {
	return renderSurfaceAssetIds
		.filter((assetId) => {
			const record = assetState.preparedByAssetId[assetId];
			if (record?.payload.kind !== "render-surface") {
				return true;
			}
			return !isTerrainRenderableRenderSurface(record.payload);
		})
		.sort(compareStrings);
}

function isTerrainRenderableRenderSurface(
	renderSurface: PreparedRenderSurfacePayload,
): boolean {
	return (
		isSupportedDirectColorFormat(renderSurface.formatRaw) ||
		isSupportedCompressedFormat(renderSurface.formatRaw) ||
		isIndexedTextureFormat(renderSurface.formatRaw)
	);
}

interface BuildDiagnosticsOptions {
	table: PreparedTerrainMaterialTablePayload;
	missingTerrainTypes: readonly number[];
	missingSurfaceTextureAssetIds: readonly string[];
	missingRenderSurfaceAssetIds: readonly string[];
	unsupportedRenderSurfaceAssetIds: readonly string[];
}

function buildDiagnostics(options: BuildDiagnosticsOptions): string[] {
	const diagnostics: string[] = [];
	if (options.table.terrainAlphaMaps.length === 0) {
		diagnostics.push("Terrain material table has no terrain alpha maps.");
	}
	if (options.table.roadAlphaMaps.length === 0) {
		diagnostics.push("Terrain material table has no road alpha maps.");
	}
	if (options.missingTerrainTypes.length > 0) {
		diagnostics.push(
			`Missing terrain type entries: ${options.missingTerrainTypes.join(", ")}.`,
		);
	}
	if (options.missingSurfaceTextureAssetIds.length > 0) {
		diagnostics.push(
			`Missing terrain surface textures: ${options.missingSurfaceTextureAssetIds.join(", ")}.`,
		);
	}
	if (options.missingRenderSurfaceAssetIds.length > 0) {
		diagnostics.push(
			`Missing selected terrain render surfaces: ${options.missingRenderSurfaceAssetIds.join(", ")}.`,
		);
	}
	if (options.unsupportedRenderSurfaceAssetIds.length > 0) {
		diagnostics.push(
			`Unsupported terrain render-surface formats: ${options.unsupportedRenderSurfaceAssetIds.join(", ")}.`,
		);
	}
	return diagnostics;
}

interface DeriveStatusOptions {
	missingSurfaceTextureAssetIds: readonly string[];
	missingRenderSurfaceAssetIds: readonly string[];
	unsupportedRenderSurfaceAssetIds: readonly string[];
}

function deriveStatus(
	options: DeriveStatusOptions,
): TerrainMaterialResourceStatus {
	if (options.unsupportedRenderSurfaceAssetIds.length > 0) {
		return "unsupported-render-surface";
	}
	if (
		options.missingSurfaceTextureAssetIds.length > 0 ||
		options.missingRenderSurfaceAssetIds.length > 0
	) {
		return "missing-texture-resources";
	}
	return "ready";
}

interface BuildTerrainMaterialSignatureOptions {
	table: PreparedTerrainMaterialTablePayload;
	pcodeSummary: TerrainPcodeSummary;
	status: TerrainMaterialResourceStatus;
	missingTerrainTypes: readonly number[];
	missingSurfaceTextureAssetIds: readonly string[];
	missingRenderSurfaceAssetIds: readonly string[];
	unsupportedRenderSurfaceAssetIds: readonly string[];
}

function buildTerrainMaterialSignature(
	options: BuildTerrainMaterialSignatureOptions,
): string {
	return [
		`terrain:${options.table.regionNumber}`,
		`status:${options.status}`,
		`types:${options.table.terrainTypes.length}`,
		`alpha:${options.table.terrainAlphaMaps.length}`,
		`roads:${options.table.roadAlphaMaps.length}`,
		`pcodes:${options.pcodeSummary.uniquePcodeCount}`,
		`missingTypes:${options.missingTerrainTypes.join(",")}`,
		`missingSurfaceTextures:${options.missingSurfaceTextureAssetIds.join(",")}`,
		`missingRenderSurfaces:${options.missingRenderSurfaceAssetIds.join(",")}`,
		`unsupportedRenderSurfaces:${options.unsupportedRenderSurfaceAssetIds.join(",")}`,
	].join("|");
}

function formatRenderSurfaceAssetId(renderSurfaceId: number): string {
	return `render-surface/${formatHex32(renderSurfaceId)}`;
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareStrings);
}
