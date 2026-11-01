/** Platform fact used by app input defaults and their displayed labels. */
export const INPUT_PLATFORMS = ["mac", "windows", "linux", "unknown"] as const;

/** Accepted platform fact at the settings and input policy boundaries. */
export type InputPlatform = (typeof INPUT_PLATFORMS)[number];

/** Resolve the browser platform once at the app entry point. Unknown hosts use common defaults. */
export function detectInputPlatform(userAgent: string): InputPlatform {
	if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
	if (/Windows/i.test(userAgent)) return "windows";
	if (/Linux/i.test(userAgent)) return "linux";
	return "unknown";
}
