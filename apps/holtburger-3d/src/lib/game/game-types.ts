// Represents a landblock ID.
export type LandblockId = string;
export type EnvCellId = string;
export type DatAssetId = string;
export const INVALID_ID = "ffffffff";

/**
 * Identity of one palette the host composited from a base palette and ObjDesc ranges.
 *
 * Opaque here: the host derives it while deciding which materials the composition applies to, and
 * nothing in the frontend re-derives or parses it.
 */
type PaletteCompositeId = string;

/** What a DAT-backed texture is prepared from: one authored resource, or one host composition. */
export type TextureSourceId = DatAssetId | PaletteCompositeId;

/** Recipe the host needs to materialize a composited palette's pixels. */
export interface PaletteComposite {
	readonly identity: PaletteCompositeId;
	readonly basePaletteId: DatAssetId;
	/** Ordered replacement ranges; later ranges overwrite earlier ones where they overlap. */
	readonly ranges: readonly PaletteCompositeRange[];
}

/** One replacement range within a palette composition, in expanded color units. */
interface PaletteCompositeRange {
	readonly replacementPaletteId: DatAssetId;
	readonly offset: number;
	readonly colorCount: number;
}
