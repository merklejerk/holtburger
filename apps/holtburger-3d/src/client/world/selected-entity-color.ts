import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";
import type { HexRgbaColor } from "../../lib/frontend-color";
import type { ClientEntityFacts } from "./entity-mirror";
import { CLIENT_TUNING } from "../settings/tuning";

type EntityNameRole =
	| "self-player"
	| "player"
	| "npc"
	| "mob"
	| "portal"
	| "lifestone"
	| "door"
	| "door-no-direct-use"
	| "switch"
	| "healing-kit"
	| "mana-stone"
	| "other";

/** Theme-overridable CSS color expression with the 3D nameplate/map default as fallback. */
export type EntityNameColorToken =
	`var(--ui-entity-name-${EntityNameRole}-color, ${HexRgbaColor})`;

function entityNameToken(
	role: EntityNameRole,
	fallback: HexRgbaColor,
): EntityNameColorToken {
	return `var(--ui-entity-name-${role}-color, ${fallback})`;
}

/** Selected and inspected names resolve through themeable CSS tokens backed by 3D/map defaults. */
export function selectedEntityNameColor(
	description: Pick<
		Extract<ClientEntityFacts["description"], { kind: "known" }>,
		"mapCategory" | "consumable"
	>,
	isSelf: boolean,
	isSummon: boolean,
): EntityNameColorToken {
	const names =
		SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors;
	const map = SHARED_FRONTEND_TUNING.map.blips.fillColors;
	if (isSummon) return entityNameToken("player", names.player);
	const category = description.mapCategory;
	switch (category) {
		case "player":
			return isSelf
				? entityNameToken("self-player", names.selfPlayer)
				: entityNameToken("player", names.player);
		case "npc":
		case "mob":
		case "portal":
			return entityNameToken(category, names[category]);
		case "lifestone":
		case "door":
		case "door-no-direct-use":
		case "switch":
			return entityNameToken(category, map[category]);
		case "other":
			if (description.consumable?.identity.category === "healing-kit")
				return entityNameToken(
					"healing-kit",
					CLIENT_TUNING.selectedEntityHud.healingKitColor,
				);
			if (description.consumable?.identity.category === "charged-mana-stone")
				return entityNameToken(
					"mana-stone",
					CLIENT_TUNING.selectedEntityHud.manaStoneColor,
				);
			return entityNameToken("other", names.other);
	}
}
