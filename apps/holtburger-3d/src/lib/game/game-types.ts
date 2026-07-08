// Represents a landblock ID.
export type LandblockId = number;
export type EnvCellId = number;
export type DatAssetId = number;

export const INVALID_ID = -1;

export function formatId(id: LandblockId | DatAssetId | EnvCellId): string {
	return id.toString(16).padStart(8, "0");
}
