// Represents a landblock ID.
export type LandblockId = string;
export type EnvCellId = string;
export type DatAssetId = string;
/**
 * Server-assigned object identity.
 *
 * Global and independent of landblock, unlike the content addresses that name DAT-authored
 * residents. Only objects carrying one can participate in object-to-object attachment, which is why
 * a wielder in one landblock can hold an item picked up in another.
 */
export type WorldObjectGuid = string;

export const INVALID_ID = "ffffffff";
