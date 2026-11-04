import type { SkySourcePresentations } from "./decode-sky-record";

/**
 * Loads the active region's closed celestial resource set.
 *
 * Separate from the landblock batch contract because the sky is regional rather than
 * landblock-scoped: it is fetched once per region, never per scene interest change.
 */
export interface SkySourceLoader {
	loadSkySource(): Promise<SkySourcePresentations>;
}
