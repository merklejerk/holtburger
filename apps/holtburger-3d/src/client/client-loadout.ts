import { z } from "zod";
import type { ClientActionBar } from "./client-action-bar-state.js";
import {
	EQUIPMENT_SLOTS,
	inventoryEquipment,
} from "./client-inventory-equipment.js";
import type { ClientEntityRead } from "./client-entity-mirror.js";

/** Existing equipment-row identity; apparel requests still equip full item coverage. */
export type EquipmentSlotMask = (typeof EQUIPMENT_SLOTS)[number]["mask"];

const slotMaskSchema = z.custom<EquipmentSlotMask>(
	(mask) => EQUIPMENT_SLOTS.some((slot) => slot.mask === mask),
	{ message: "Unknown equipment slot" },
);

/** Curated emoji choices shared by the popup selector and persisted action icons. */
export const LOADOUT_ICONS = [
	"⭐",
	"❤️",
	"♦️",
	"🔵",
	"🟩",
	"🔺",
	"🌙",
	"☀️",
	"❄️",
	"🍀",
	"⚡",
	"🔥",
	"✨",
	"🌟",
	"💫",
	"💖",
	"💜",
	"💙",
	"💚",
	"🧡",
	"💛",
	"🤍",
	"🖤",
	"💔",
	"🔴",
	"🟠",
	"🟡",
	"🟢",
	"🟣",
	"⚫",
	"⚪",
	"🔶",
	"🔷",
	"🔸",
	"🔹",
	"🔻",
	"💎",
	"⚔️",
	"🛡️",
	"🏹",
	"🪓",
	"🔨",
	"🗡️",
	"🔮",
	"🪄",
	"📜",
	"📖",
	"🧪",
	"👑",
	"💀",
	"👻",
	"🐉",
	"🐺",
	"🦊",
	"🦁",
	"🐻",
	"🦅",
	"🦉",
	"🦋",
	"🐍",
	"🌞",
	"🌈",
	"☁️",
	"🌧️",
	"🌊",
	"💧",
	"🌪️",
	"🌋",
	"🌲",
	"🌸",
	"🌻",
	"🍁",
	"🎯",
	"🎲",
	"♠️",
	"♣️",
	"🧭",
	"⚓",
	"🏔️",
	"🏰",
	"🗝️",
	"🔔",
	"🎵",
	"⚖️",
] as const;

/** Draft defaults avoid icons already saved anywhere in this character's action bars. */
export function chooseLoadoutIcon(
	bars: readonly ClientActionBar[],
): (typeof LOADOUT_ICONS)[number] {
	const used = new Set(
		bars.flatMap((bar) =>
			bar.slots.flatMap((content) =>
				content?.kind === "loadout" ? [content.icon] : [],
			),
		),
	);
	const unused = LOADOUT_ICONS.filter((icon) => !used.has(icon));
	// Palette exhaustion still permits creation; saved icons are suggestions, not reservations.
	const choices = unused.length === 0 ? LOADOUT_ICONS : unused;
	return choices[Math.floor(Math.random() * choices.length)];
}

/** Occupied and explicitly empty bindings cannot have inconsistent item/name pairs. */
const loadoutBindingSchema = z.union([
	z
		.object({
			/** Saved equipment row; repeated apparel GUIDs retain distinct display rows. */
			slot: slotMaskSchema,
			/** Exact instance, never substituted by name or template. */
			item: z.number().int().positive().max(0xffff_ffff),
			/** Captured label remains available when inventory no longer contains the item. */
			name: z.string().trim().min(1),
		})
		.strict()
		.readonly(),
	z
		.object({
			/** Checked empty rows explicitly request whole-item removal at this slot. */
			slot: slotMaskSchema,
			/** Null is an unequip request, distinct from an omitted row. */
			item: z.null(),
			/** Empty requests have no captured item identity or label. */
			name: z.null(),
		})
		.strict()
		.readonly(),
]);
export type LoadoutBinding = z.infer<typeof loadoutBindingSchema>;

/** Immutable character action-cell content; no separate record or library identity. */
export const loadoutActionContentSchema = z
	.object({
		/** Discriminates saved snapshots from ordinary item actions. */
		kind: z.literal("loadout"),
		/** Optional custom label; blank names display the standard Loadout label. */
		name: z.string().trim(),
		/** Selected emoji; existing saved snapshots receive the initial star choice. */
		icon: z.enum(LOADOUT_ICONS).default(LOADOUT_ICONS[0]),
		/** Sparse immutable snapshot submitted in the captured equipment-row order. */
		bindings: z
			.array(loadoutBindingSchema)
			.min(1)
			.max(EQUIPMENT_SLOTS.length)
			.refine(
				(bindings) =>
					new Set(bindings.map((binding) => binding.slot)).size ===
					bindings.length,
				{ message: "Loadout slots must be unique" },
			)
			.readonly(),
	})
	.strict()
	.readonly();
export type LoadoutActionContent = z.infer<typeof loadoutActionContentSchema>;

/** Capture is explicit about hydration rather than presenting unknown slots as empty. */
export type LoadoutCapture =
	| { readonly kind: "ready"; readonly bindings: readonly LoadoutBinding[] }
	| { readonly kind: "unavailable"; readonly reason: string };

/** One opening snapshot carries its initial icon so saved-bar changes never reset an active draft. */
export type LoadoutDraft = Extract<LoadoutCapture, { kind: "ready" }> & {
	/** Random unused emoji chosen once when the builder opens. */
	readonly icon: (typeof LOADOUT_ICONS)[number];
};

/** Capture one confirmed equipment snapshot; a draft never follows subsequent equipment updates. */
export function captureLoadout(read: ClientEntityRead): LoadoutCapture {
	if (read.kind !== "current")
		return { kind: "unavailable", reason: "Equipment facts are unavailable." };
	const equipment = inventoryEquipment(read.level);
	if (equipment.pending)
		return {
			kind: "unavailable",
			reason: "Waiting for confirmed equipment locations.",
		};
	const bindings: LoadoutBinding[] = [];
	for (const { slot, item } of equipment.rows) {
		if (item === null) {
			bindings.push({ slot: slot.mask, item: null, name: null });
			continue;
		}
		if (
			item.description.kind !== "known" ||
			item.description.name.trim().length === 0
		)
			return {
				kind: "unavailable",
				reason: "Waiting for equipped item names.",
			};
		bindings.push({
			slot: slot.mask,
			item: item.guid,
			name: item.description.name,
		});
	}
	return { kind: "ready", bindings };
}

/** Naming is optional; the standard label is shared by cells, tooltips, and drag feedback. */
export function loadoutLabel(content: LoadoutActionContent): string {
	return content.name.length === 0 ? "Loadout" : content.name;
}

/** Friendly snapshot presentation is independent of current inventory availability. */
export function loadoutTooltip(content: LoadoutActionContent): string {
	return [
		content.name.length === 0 ? "Loadout" : `Loadout "${content.name}"`,
		...content.bindings.map(
			(binding) =>
				`${equipmentSlotLabel(binding.slot)}: ${binding.item === null ? "Empty" : binding.name}`,
		),
	].join("\n");
}

/** Slot vocabulary belongs to this app, never to shared equipment execution. */
export function equipmentSlotLabel(mask: number): string {
	const slot = EQUIPMENT_SLOTS.find((candidate) => candidate.mask === mask);
	if (slot === undefined) throw new Error(`Unknown equipment slot ${mask}`);
	return slot.label;
}
