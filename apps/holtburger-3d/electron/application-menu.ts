import type { MenuItemConstructorOptions } from "electron";

/** Preserve native macOS responder commands without adding a window menu bar elsewhere. */
export function applicationMenuTemplate(
	platform: NodeJS.Platform,
): MenuItemConstructorOptions[] | null {
	if (platform !== "darwin") return null;
	return [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }];
}
