import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import type { HexRgbaColor } from "../lib/frontend-color";
import type { ClientEntityFacts } from "./client-entity-mirror";
import { CLIENT_TUNING } from "./client-tuning";

/** Selected text uses nameplate colors first, then existing map colors and item accents. */
export function selectedEntityNameColor(
	description: Pick<
		Extract<ClientEntityFacts["description"], { kind: "known" }>,
		"mapCategory" | "objectFlags" | "itemType"
	>,
	isSelf: boolean,
): HexRgbaColor {
	const names =
		SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors;
	const map = SHARED_FRONTEND_TUNING.map.blips.fillColors;
	const category = description.mapCategory;
	switch (category) {
		case "player":
			return isSelf ? names.selfPlayer : names.player;
		case "npc":
		case "mob":
		case "portal":
			return names[category];
		case "lifestone":
		case "door":
		case "door-no-direct-use":
		case "switch":
			return map[category];
		case "other":
			// Item accents are frontend policy, following the TUI's public item masks.
			if (description.objectFlags & 0x00010000)
				return CLIENT_TUNING.selectedEntityHud.healingKitColor;
			if (description.itemType & 0x00080000)
				return CLIENT_TUNING.selectedEntityHud.manaStoneColor;
			return names.other;
	}
}
