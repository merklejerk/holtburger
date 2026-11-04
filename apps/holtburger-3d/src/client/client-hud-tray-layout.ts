import type { ClientHudPlacement } from "./client-hud-layout";

/** The tray's fixed long axis records its orientation in the saved placement. */
export function hudTrayOrientation(
	placement: ClientHudPlacement,
): "horizontal" | "vertical" {
	if (placement.preferredWidth > placement.preferredHeight) return "horizontal";
	if (placement.preferredHeight > placement.preferredWidth) return "vertical";
	throw new Error("HUD tray placement must have a distinct long axis.");
}

/** Rotate the fixed-size tray without moving its viewport anchor. */
export function rotateHudTray(
	placement: ClientHudPlacement,
): ClientHudPlacement {
	hudTrayOrientation(placement);
	return {
		...placement,
		preferredWidth: placement.preferredHeight,
		preferredHeight: placement.preferredWidth,
	};
}
