import { join } from "node:path";

/** Keep development Chromium/config state disjoint from the packaged product profile. */
export function clientUserDataPath(
	appDataPath: string,
	applicationName: string,
	packaged: boolean,
): string {
	return join(
		appDataPath,
		packaged ? applicationName : `${applicationName}-dev`,
	);
}
