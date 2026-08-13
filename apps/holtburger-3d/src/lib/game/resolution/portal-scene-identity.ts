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

/**
 * Qualify one HBEC-local junction group for global scene topology.
 *
 * Record-local groups restart at one in every landblock, while junction equality must hold across
 * the whole composed topology: outdoor is a single render domain, so two landblocks' "group 1"
 * must not compare equal. Packing the landblock's grid coordinates above the local ordinal keeps
 * the identity deterministic and stateless; zero remains "no junction" on the GPU.
 */
export function qualifyJunctionGroupId(
	landblockId: LandblockId,
	junctionGroupId: number | null,
): number | null {
	if (junctionGroupId === null) return null;
	if (!Number.isInteger(junctionGroupId) || junctionGroupId < 1) {
		throw new Error(
			`Junction group ${junctionGroupId} is not a positive ordinal.`,
		);
	}
	if (junctionGroupId > 0xffff) {
		throw new Error(
			`Junction group ${junctionGroupId} exceeds the 16-bit landblock-local budget.`,
		);
	}
	const grid = Number.parseInt(landblockId.slice(2, 6), 16);
	if (Number.isNaN(grid)) {
		throw new Error(
			`Junction group owner ${landblockId} is not a landblock id.`,
		);
	}
	return grid * 0x1_0000 + junctionGroupId;
}
