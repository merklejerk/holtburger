import type { LandblockEnvCellStaticFacts } from "../../contracts";

export function createEnvCellPortalPolygonIdSet(
	envCell: LandblockEnvCellStaticFacts,
): ReadonlySet<number> {
	return new Set([
		...envCell.portals.map((portal) => portal.polygonId),
		...envCell.portalApertures.map((aperture) => aperture.polygonId),
	]);
}
