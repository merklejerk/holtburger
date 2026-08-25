import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Inputs needed to validate renderer navigation without depending on Electron globals. */
export interface NavigationPolicy {
	readonly packaged: boolean;
	readonly appPath: string;
	readonly developmentOrigin: string;
}

/** Accept only the exact development origin or a file physically contained by packaged `dist`. */
export function isAllowedNavigation(
	targetUrl: string,
	policy: NavigationPolicy,
): boolean {
	let target: URL;
	try {
		target = new URL(targetUrl);
	} catch {
		return false;
	}
	if (!policy.packaged) return target.origin === policy.developmentOrigin;
	if (target.protocol !== "file:") return false;
	let targetPath: string;
	try {
		targetPath = fileURLToPath(target);
	} catch {
		return false;
	}
	const distPath = join(policy.appPath, "dist");
	const relativePath = relative(distPath, targetPath);
	return (
		relativePath === "" ||
		(relativePath !== ".." &&
			!relativePath.startsWith(`..${sep}`) &&
			!isAbsolute(relativePath))
	);
}
