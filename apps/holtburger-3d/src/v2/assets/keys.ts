import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockEnvCellsAssetId,
	formatLandblockOutdoorAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type { HostAssetKey, HostAssetKeyKind } from "./contracts";

const HEX32_ROUTE_KINDS = new Set<HostAssetKeyKind>([
	"env-cell",
	"gfx-obj",
	"setup-model",
	"setup-appearance",
	"material",
	"surface-texture",
	"render-surface",
	"prepared-texture",
	"palette",
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

export function describeHostAssetKey(key: HostAssetKey): string {
	return `${key.kind}:${key.id}`;
}

export function formatHostAssetId(key: HostAssetKey): string {
	if (key.kind === "raw") {
		return key.id;
	}

	if (key.kind === "landblock-outdoor") {
		return formatLandblockOutdoorAssetId(parseHex32RouteId(key));
	}

	if (key.kind === "landblock-env-cells") {
		return formatLandblockEnvCellsAssetId(parseHex32RouteId(key));
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
	const landblockMatch =
		/^landblock\/([0-9a-fA-F]{8})\/(outdoor|env-cells)$/.exec(assetId);
	if (landblockMatch) {
		const routeKind = landblockMatch[2];
		return createHostAssetKey(
			routeKind === "outdoor" ? "landblock-outdoor" : "landblock-env-cells",
			Number.parseInt(landblockMatch[1] as string, 16),
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

	if (typeof id !== "number") {
		throw new Error(`${kind} route id must be numeric: ${id}`);
	}

	if (kind === "landblock-outdoor" || kind === "landblock-env-cells") {
		return formatHex32(normalizeOutdoorLandblockId(id));
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

function isKnownHostAssetKeyKind(kind: string): kind is HostAssetKeyKind {
	return (
		kind === "landblock-outdoor" ||
		kind === "landblock-env-cells" ||
		kind === "env-cell" ||
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
