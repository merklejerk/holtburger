import type { ItemIconDisplay } from "../app/item-icon-repository";
import type { ClientEntityFacts } from "./client-entity-mirror";

/** Known owned equipment accepted as an action binding; execution admission stays in core. */
type BindingEquipment = ClientEntityFacts & {
	readonly ownedByPlayer: true;
	readonly description: Extract<
		ClientEntityFacts["description"],
		{ kind: "known" }
	>;
};

/** One binding-eligibility decision shared by drops, presentation, and activation. */
export function isBindingEquipment(
	item: ClientEntityFacts | undefined,
): item is BindingEquipment {
	return (
		item?.ownedByPlayer === true &&
		item.description.kind === "known" &&
		item.description.equipLocations !== null &&
		item.description.equipLocations !== 0
	);
}

/** Sampled bound-item presentation, independent of retained binding identity. */
export interface ActionEquipmentDisplay {
	/** Known item name or explicit unavailable identity. */
	readonly label: string;
	/** Binding admission only; core owns execution admission. */
	readonly available: boolean;
	/** Confirmed player equipment state; never inferred from a submitted command. */
	readonly equipped: boolean;
	/** Repository-owned artwork protected by the collection's display lease. */
	readonly display: ItemIconDisplay | undefined;
}
