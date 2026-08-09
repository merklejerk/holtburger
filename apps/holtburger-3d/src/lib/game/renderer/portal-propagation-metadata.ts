import { PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES } from "./portal-arrival-metadata";
import { PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES } from "./portal-scope-tile-metadata";

/** One std140 `mat4` shared by every propagation-program parity variant. */
const PORTAL_PROPAGATION_CAMERA_METADATA_BYTES = 64;
/** Arrival records follow the frame's anchor-to-clip transform. */
export const PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES =
	PORTAL_PROPAGATION_CAMERA_METADATA_BYTES;
/** Scope records begin after the transform and all R8UI-addressable arrival records. */
export const PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES =
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES;
/** The selected layout exactly fills WebGL2's guaranteed 16 KiB uniform block. */
export const PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES =
	PORTAL_PROPAGATION_CAMERA_METADATA_BYTES +
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES +
	PORTAL_SCOPE_TILE_METADATA_CAPACITY_BYTES;
