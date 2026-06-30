import type {
	StaticPortalInteriorRecord,
} from "./contracts";

export function createEnvCellPortalApertureRangeId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"portal-aperture",
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}

export function createEnvCellPortalApertureSourceId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
