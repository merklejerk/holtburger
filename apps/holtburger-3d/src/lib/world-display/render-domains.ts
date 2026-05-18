export const WORLD_RENDER_DOMAIN = {
	terrain: "terrain",
	exteriorStatic: "exterior-static",
	interiorCellShell: "interior-cell-shell",
	interiorStatic: "interior-static",
	portalAperture: "portal-aperture",
	debugOverlay: "debug-overlay",
} as const;

export type WorldRenderDomain =
	(typeof WORLD_RENDER_DOMAIN)[keyof typeof WORLD_RENDER_DOMAIN];

export type StaticRenderableRenderDomain =
	| typeof WORLD_RENDER_DOMAIN.exteriorStatic
	| typeof WORLD_RENDER_DOMAIN.interiorStatic;

export function formatRenderDomainKey(
	domain: WorldRenderDomain,
	localKey: string,
): string {
	return `${domain}/${localKey}`;
}
