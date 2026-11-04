import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
import { sceneMapPoint } from "../../lib/game/map/map-coordinates";
import type { ResolvedEnchantments } from "../../client/client-enchantments-contract";
import type { ClientVital } from "../../client/client-host-contract";
import type { CharacterSheet } from "../../client/client-character-sheet-contract";
import type { ClientActionBar } from "../../client/client-action-bar-state";
import { initialActionBar } from "../../client/client-action-bar-state";
import { EQUIPMENT_SLOTS } from "../../client/client-inventory-equipment";

/** Fixed presentation order shared by controls and initial session vitals. */
export const SHOWCASE_VITAL_KINDS = ["health", "stamina", "mana"] as const;

/** Off-disc destination exposes the production direction arrow and distance footer. */
export const SHOWCASE_WAYPOINT: MapWaypointTarget = {
	position: sceneMapPoint(500, -800),
	label: "Traveler’s camp",
};

/** Reserved sample GUIDs avoid the domain fixtures’ inventory IDs. */
export const SHOWCASE_ITEM_GUID_BASE = 60_000;

/** Panels open in the same production client and retain their ordinary window lifetime. */
export const SHOWCASE_PANELS = [
	{ value: "inventory", label: "Inventory / equipment" },
	{ value: "vendor", label: "Vendor" },
	{ value: "trade", label: "Trade" },
	{ value: "inspection", label: "Item inspection" },
	{ value: "book", label: "Book reader" },
	{ value: "spells", label: "Spell bar" },
	{ value: "combat", label: "Combat controls" },
	{ value: "salvage", label: "Salvage" },
] as const;
/** A local fixture command, never a navigation destination. */
export type ShowcasePanel = (typeof SHOWCASE_PANELS)[number]["value"];

/** Cold preview state and commands owned by the existing client fixture. */
export interface UiShowcaseSession {
	/** Bounded user-edited vital values, also consumed by the real HUD and warning overlay. */
	readonly vitals: readonly ClientVital[];
	/** The production overlay's admission switch. */
	readonly warningsEnabled: boolean;
	/** Real HUD layout editing state. */
	readonly editable: boolean;
	/** Current fixture charge, sampled by the production jump bar. */
	readonly jumpExtent: number;
	/** Whether the charge bar is currently presented. */
	readonly jumpActive: boolean;
	/** Current waypoint admission, also cleared by the production footer action. */
	readonly waypointEnabled: boolean;
	/** Open a production panel without replacing the stage or client owner. */
	readonly openPanel: (panel: ShowcasePanel) => Promise<void>;
	/** Change one vital through the same values read by the HUD and warning system. */
	readonly setVital: (kind: ClientVital["kind"], percent: number) => void;
	/** Enable or withdraw production low-vital effects. */
	readonly setWarningsEnabled: (enabled: boolean) => void;
	/** Change production HUD editing policy. */
	readonly setEditable: (editable: boolean) => void;
	/** Change the same charge state consumed by the game view. */
	readonly setJump: (extent: number, active: boolean) => void;
	/** Set or clear a sample destination through the existing navigation owner. */
	readonly setWaypointEnabled: (enabled: boolean) => void;
	/** Restore production HUD placements and representative action bars. */
	readonly resetLayout: () => void;
	/** Restart the existing item cooldown source for its specimen. */
	readonly restartCooldown: () => void;
	/** Shared production notice surface for local specimen actions. */
	readonly notify: (message: string) => void;
}

/** Half-full level progress remains visible without a server or purchases. */
export const SHOWCASE_CHARACTER_SHEET = {
	character: 1,
	name: "Wayfarer",
	title: null,
	titleSelection: null,
	maximumLuminance: null,
	level: {
		level: 10,
		currentXp: "9500",
		unspentXp: "500",
		unspentSkillPoints: 0,
		availableLuminance: "0",
		nextLevelXp: "10000",
		xpIntoLevel: "500",
		xpForNextLevel: "1000",
	},
	attributes: [],
	vitals: [],
	skills: [],
	armor: 0,
	resistances: {
		slash: 1,
		pierce: 1,
		bludgeon: 1,
		fire: 1,
		cold: 1,
		acid: 1,
		electric: 1,
		nether: 1,
	},
	vitae: 1,
	guardedTargets: [],
} satisfies CharacterSheet;

/** Sparse production bindings cover both orientations, loadouts, unavailable and empty slots. */
export function showcaseActionBars(): readonly ClientActionBar[] {
	const first: ClientActionBar = {
		...initialActionBar(),
		slots: [
			{ kind: "equipment", item: SHOWCASE_ITEM_GUID_BASE, replacement: null },
			{ kind: "direct", item: SHOWCASE_ITEM_GUID_BASE + 1, replacement: null },
			{ kind: "direct", item: SHOWCASE_ITEM_GUID_BASE + 2, replacement: null },
			{ kind: "direct", item: 999, replacement: null },
			{
				kind: "loadout",
				name: "Travel gear",
				icon: "🛡️",
				bindings: [
					{
						slot: EQUIPMENT_SLOTS[0].mask,
						item: SHOWCASE_ITEM_GUID_BASE,
						name: "Traveler’s equipment",
					},
				],
			},
			null,
			null,
			null,
			null,
			null,
		],
	};
	return [
		first,
		{
			...first,
			id: 2,
			orientation: "vertical",
			shape: "double",
			anchor: {
				horizontal: { alignment: "end", offset: 16 },
				vertical: { alignment: "start", offset: 320 },
			},
		},
	];
}

/** Both status categories remain available while the same snapshot carries a cooldown. */
export const SHOWCASE_ENCHANTMENTS: ResolvedEnchantments = {
	instances: ["beneficial", "harmful"].map((kind, index) => ({
		key: { spellId: index === 0 ? 1 : 666, layer: 0 },
		spellCategory: index + 1,
		powerLevel: 1,
		kind: kind === "beneficial" ? "beneficial" : "harmful",
		remainingSeconds: 120,
		statModType: 0,
		statModKey: 0,
		statModValue: 1,
	})),
	groups: [],
	cooldowns: [{ groupId: 1, remainingSeconds: 12 }],
};
