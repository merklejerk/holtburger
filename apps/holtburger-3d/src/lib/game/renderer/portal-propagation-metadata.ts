import { PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES } from "./portal-arrival-metadata";
import { PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES } from "./portal-scope-tile-metadata";

/** Scope records begin after all R8UI-addressable arrival records. */
export const PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES =
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES;
/** One fixed block keeps camera metadata to one upload and one shader binding. */
export const PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES =
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES +
	PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES;
