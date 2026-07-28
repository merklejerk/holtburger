import type { LandblockId } from "../game-types";
import type {
	PortalApertureId,
	ResolvedPortalCrossing,
} from "./landblock-layer";

/** Qualify one HBEC-local aperture identity for global SceneGraph/resource ownership. */
export function qualifyPortalApertureId(
	landblockId: LandblockId,
	id: PortalApertureId,
): PortalApertureId {
	return `portal-aperture:${landblockId}/${id.slice("portal-aperture:".length)}`;
}

/** Qualify one HBEC-local directed crossing identity for global SceneGraph ownership. */
export function qualifyPortalCrossingId(
	landblockId: LandblockId,
	id: ResolvedPortalCrossing["id"],
): ResolvedPortalCrossing["id"] {
	return `portal-crossing:${landblockId}/${id.slice("portal-crossing:".length)}`;
}
