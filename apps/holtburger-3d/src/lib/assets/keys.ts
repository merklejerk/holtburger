import {
	formatEnvCellAssetId,
	formatHex32,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type { HostAssetKey, HostAssetKeyKind } from "./contracts";

const HEX32_ROUTE_KINDS = new Set<HostAssetKeyKind>([
	"env-cell",
	"animation",
	"gfx-obj",
	"setup-model",
	"material",
	"surface-texture",
	"render-surface",
	"render-surface-metadata",
	"prepared-texture",
	"palette",
	"palette-metadata",
]);

export function createHostAssetKey(
	kind: HostAssetKeyKind,
	id: string | number,
): HostAssetKey {
	return {
		id: normalizeAssetKeyId(kind, id),
		kind,
	};
}

export function createRawHostAssetKey(assetId: string): HostAssetKey {
	return {
		id: assetId,
		kind: "raw",
	};
}

export function createLandblockSceneLodHostAssetKey(
	landblockId: number,
	level: number,
): HostAssetKey {
	return createHostAssetKey(
		"landblock-scene-lod",
		`${formatHex32(normalizeOutdoorLandblockId(landblockId))}:${normalizeSceneLodLevel(level)}`,
	);
}

export function describeHostAssetKey(key: HostAssetKey): string {
	return `${key.kind}:${key.id}`;
}

export function formatHostAssetId(key: HostAssetKey): string {
	if (key.kind === "raw") {
		return key.id;
	}

	if (key.kind === "landblock-scene-lod") {
		const { landblockId, level } = parseLandblockSceneLodRouteId(key);
		return `landblock/${formatHex32(landblockId)}/lod/${level}`;
	}

	if (
		key.kind === "landblock-scene-lod-outdoor-layer" ||
		key.kind === "landblock-scene-lod-env-cell-layer"
	) {
		throw new Error(
			`${key.kind} is a resolver-local source payload key and has no host route.`,
		);
	}

	if (key.kind === "env-cell") {
		return formatEnvCellAssetId(parseHex32RouteId(key));
	}

	if (key.kind === "terrain-material") {
		return formatTerrainMaterialAssetId(parseDecimalRouteId(key));
	}

	if (key.kind === "region-render-profile") {
		return formatRegionRenderProfileAssetId(parseDecimalRouteId(key));
	}

	return `${key.kind}/${key.id}`;
}

export function parseHostAssetId(assetId: string): HostAssetKey {
	const lodMatch = /^landblock\/([0-9a-fA-F]{8})\/lod\/([0-4])$/.exec(assetId);
	if (lodMatch) {
		return createLandblockSceneLodHostAssetKey(
			Number.parseInt(lodMatch[1] as string, 16),
			Number.parseInt(lodMatch[2] as string, 10),
		);
	}

	const routeMatch = /^([^/]+)\/(.+)$/.exec(assetId);
	if (!routeMatch) {
		return createRawHostAssetKey(assetId);
	}

	const kind = routeMatch[1] as HostAssetKeyKind;
	const id = routeMatch[2] as string;

	if (!isKnownHostAssetKeyKind(kind)) {
		return createRawHostAssetKey(assetId);
	}

	if (kind === "setup-appearance") {
		return createHostAssetKey(kind, id);
	}

	if (kind === "prepared-texture" && id.includes("?")) {
		return createHostAssetKey(kind, id);
	}

	if (HEX32_ROUTE_KINDS.has(kind)) {
		return createHostAssetKey(kind, Number.parseInt(id, 16));
	}

	return createHostAssetKey(kind, Number.parseInt(id, 10));
}

function normalizeAssetKeyId(
	kind: HostAssetKeyKind,
	id: string | number,
): string {
	if (
		kind === "raw" ||
		(kind === "prepared-texture" && typeof id === "string")
	) {
		return `${id}`.trim();
	}

	if (kind === "setup-appearance" && typeof id === "string") {
		return normalizeSetupAppearanceRouteId(id);
	}

	if (kind === "landblock-scene-lod" && typeof id === "string") {
		return normalizeLandblockSceneLodRouteId(id);
	}

	if (typeof id !== "number") {
		throw new Error(`${kind} route id must be numeric: ${id}`);
	}

	if (kind === "setup-appearance") {
		return formatHex32(id);
	}

	if (
		kind === "landblock-scene-lod-outdoor-layer" ||
		kind === "landblock-scene-lod-env-cell-layer"
	) {
		return formatHex32(normalizeOutdoorLandblockId(id));
	}

	if (kind === "landblock-scene-lod") {
		throw new Error(
			"landblock-scene-lod route id requires landblock hex and LoD level.",
		);
	}

	if (HEX32_ROUTE_KINDS.has(kind)) {
		return formatHex32(id);
	}

	return `${assertNonnegativeInteger(id, kind)}`;
}

function parseHex32RouteId(key: HostAssetKey): number {
	if (!/^[0-9a-fA-F]{8}$/.test(key.id)) {
		throw new Error(
			`Host asset key ${describeHostAssetKey(key)} needs hex32 id.`,
		);
	}

	return Number.parseInt(key.id, 16) >>> 0;
}

function parseDecimalRouteId(key: HostAssetKey): number {
	const parsed = Number.parseInt(key.id, 10);
	return assertNonnegativeInteger(parsed, key.kind);
}

function assertNonnegativeInteger(value: number, kind: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${kind} route id must be a nonnegative integer: ${value}`);
	}

	return value;
}

function normalizeSetupAppearanceRouteId(id: string): string {
	const trimmed = id.trim();
	if (!/^[0-9a-fA-F]{8}(?:\?.+)?$/.test(trimmed)) {
		throw new Error(
			`setup-appearance route id must be hex32 with optional query: ${id}`,
		);
	}

	return trimmed;
}

function normalizeLandblockSceneLodRouteId(id: string): string {
	const trimmed = id.trim();
	const match = /^([0-9a-fA-F]{8}):([0-4])$/.exec(trimmed);
	if (!match) {
		throw new Error(
			`landblock-scene-lod route id must be hex32:level with level 0..4: ${id}`,
		);
	}

	return `${formatHex32(normalizeOutdoorLandblockId(Number.parseInt(match[1] as string, 16)))}:${match[2]}`;
}

function parseLandblockSceneLodRouteId(key: HostAssetKey): {
	readonly landblockId: number;
	readonly level: number;
} {
	const match = /^([0-9a-fA-F]{8}):([0-4])$/.exec(key.id);
	if (!match) {
		throw new Error(
			`Host asset key ${describeHostAssetKey(key)} needs hex32:level id.`,
		);
	}

	return {
		landblockId: Number.parseInt(match[1] as string, 16) >>> 0,
		level: Number.parseInt(match[2] as string, 10),
	};
}

function normalizeSceneLodLevel(level: number): number {
	if (!Number.isInteger(level) || level < 0 || level > 4) {
		throw new Error(
			`landblock-scene-lod level must be an integer from 0 through 4: ${level}`,
		);
	}

	return level;
}

function isKnownHostAssetKeyKind(kind: string): kind is HostAssetKeyKind {
	return (
		kind === "landblock-scene-lod" ||
		kind === "landblock-scene-lod-outdoor-layer" ||
		kind === "landblock-scene-lod-env-cell-layer" ||
		kind === "env-cell" ||
		kind === "animation" ||
		kind === "gfx-obj" ||
		kind === "setup-model" ||
		kind === "setup-appearance" ||
		kind === "material" ||
		kind === "terrain-material" ||
		kind === "region-render-profile" ||
		kind === "surface-texture" ||
		kind === "render-surface" ||
		kind === "prepared-texture" ||
		kind === "palette" ||
		kind === "raw"
	);
}
