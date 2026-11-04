import { afterEach, describe, expect, it, vi } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";
import { EQUIPMENT_SLOTS } from "./client-inventory-equipment";
import {
	captureLoadout,
	chooseLoadoutIcon,
	LOADOUT_ICONS,
	loadoutActionContentSchema,
	loadoutTooltip,
} from "./client-loadout";
import {
	bindActionCell,
	cloneActionBar,
	requireActionBar,
} from "./client-action-bar-state";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import { reconcileActionBars } from "./client-action-bar-reconciliation";
import { clientCharacterSettingsSchema } from "./client-settings-contract";
import { createDefaultClientCharacterSettings } from "./client-settings-defaults";

function slot(label: string) {
	const found = EQUIPMENT_SLOTS.find((candidate) => candidate.label === label);
	if (found === undefined) throw new Error(`Missing fixture slot ${label}`);
	return found.mask;
}
function read(...entities: ClientEntityFacts[]): ClientEntityRead {
	return {
		kind: "current",
		level: {
			playerGuid: 1,
			revision: 1,
			projectileSupply: { kind: "not-applicable" },
			salvage: {
				skills: {
					salvagingSkill: 0,
					tinkeringSkill: 0,
					augmentationBonusSalvage: 0,
				},
			},
			worldContainer: { kind: "closed" },
			entities: new Map(entities.map((entity) => [entity.guid, entity])),
		},
	};
}
const saved = () =>
	loadoutActionContentSchema.parse({
		kind: "loadout",
		name: "Travel",
		bindings: [{ slot: slot("Left ring"), item: 91, name: "Silver Ring" }],
	});

describe("immutable loadout action cells", () => {
	it("captures confirmed equipment and repeats full armor across its display rows", () => {
		const armor = entityFacts(2, {
			ownedByPlayer: true,
			location: {
				kind: "equipped",
				wearerGuid: 1,
				mask: slot("Chest armor") | slot("Upper arm armor"),
			},
		});
		const capture = captureLoadout(read(armor, entityFacts(3)));
		if (capture.kind !== "ready") throw new Error("Capture was unavailable");
		expect(capture.bindings.filter((binding) => binding.item !== null)).toEqual(
			[
				{ slot: slot("Chest armor"), item: armor.guid, name: "Item 2" },
				{ slot: slot("Upper arm armor"), item: armor.guid, name: "Item 2" },
			],
		);
		expect(capture.bindings).toHaveLength(EQUIPMENT_SLOTS.length);
	});
	it("distinguishes empty equipment from incomplete descriptions and locations", () => {
		const empty = captureLoadout(read());
		if (empty.kind !== "ready")
			throw new Error("Empty capture was unavailable");
		expect(empty.bindings).toHaveLength(EQUIPMENT_SLOTS.length);
		expect(
			empty.bindings.every(
				(binding) => binding.item === null && binding.name === null,
			),
		).toBe(true);
		expect(captureLoadout({ kind: "pending" }).kind).toBe("unavailable");
		expect(
			captureLoadout(
				read(
					entityFacts(2, {
						ownedByPlayer: true,
						location: { kind: "equipped", wearerGuid: 1, mask: null },
					}),
				),
			).kind,
		).toBe("unavailable");
		expect(
			captureLoadout(
				read(
					entityFacts(2, {
						ownedByPlayer: true,
						description: { kind: "pending" },
						location: { kind: "equipped", wearerGuid: 1, mask: slot("Head") },
					}),
				),
			).kind,
		).toBe("unavailable");
	});
	it("rejects empty selections, duplicate rows, invalid icons, and inconsistent empty bindings", () => {
		const content = saved();
		for (const candidate of [
			{ ...content, icon: "not-a-choice" },
			{ ...content, bindings: [{ ...content.bindings[0], item: null }] },
			{ ...content, bindings: [] },
			{ ...content, bindings: [...content.bindings, ...content.bindings] },
			{ ...content, bindings: [{ ...content.bindings[0], slot: 0 }] },
		])
			expect(loadoutActionContentSchema.safeParse(candidate).success).toBe(
				false,
			);
	});
	it("accepts unnamed empty-slot snapshots with a selected emoji", () => {
		const content = loadoutActionContentSchema.parse({
			kind: "loadout",
			name: " ",
			icon: "❤️",
			bindings: [{ slot: slot("Main hand"), item: null, name: null }],
		});
		expect(loadoutTooltip(content)).toBe("Loadout\nMain hand: Empty");
		expect(content.icon).toBe("❤️");
	});
	it("round trips inside character action bars and survives missing inventory", () => {
		const content = saved();
		const defaults = createDefaultClientCharacterSettings();
		const bars = bindActionCell(
			defaults.actionBars,
			{ bar: 1, slot: 0 },
			content,
		);
		const persisted = clientCharacterSettingsSchema.parse(
			JSON.parse(JSON.stringify({ ...defaults, actionBars: bars })),
		);
		expect(persisted.actionBars[0]?.slots[0]).toEqual(content);
		expect(reconcileActionBars(bars, read())).toBe(bars);
		expect(loadoutTooltip(content)).toContain("Left ring: Silver Ring");
	});
	it("copies independent snapshots and deletes content with its cell", () => {
		const defaults = createDefaultClientCharacterSettings();
		const bars = bindActionCell(
			defaults.actionBars,
			{ bar: 1, slot: 0 },
			saved(),
		);
		const clone = cloneActionBar(bars, 1, {
			id: 2,
			anchor: requireActionBar(defaults.actionBars, 1).anchor,
		});
		const removed = bindActionCell(clone, { bar: 1, slot: 0 }, null);
		expect(removed[0]?.slots[0]).toBeNull();
		expect(removed[1]?.slots[0]).toEqual(saved());
		expect(defaults.actionBars[0]?.slots[0]).toBeNull();
	});
});

describe("new loadout icons", () => {
	afterEach(() => vi.restoreAllMocks());
	function barsUsing(icons: readonly (typeof LOADOUT_ICONS)[number][]) {
		let bars = createDefaultClientCharacterSettings().actionBars;
		for (const [index, icon] of icons.entries()) {
			const id = Math.floor(index / ACTION_SLOT_INDICES.length) + 1;
			if (!bars.some((bar) => bar.id === id))
				bars = cloneActionBar(bars, 1, {
					id,
					anchor: requireActionBar(bars, 1).anchor,
				});
			bars = bindActionCell(
				bars,
				{
					bar: id,
					slot: ACTION_SLOT_INDICES[index % ACTION_SLOT_INDICES.length],
				},
				{ ...saved(), icon },
			);
		}
		return bars;
	}
	it("samples the available palette randomly", () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(1 - Number.EPSILON);
		const bars = createDefaultClientCharacterSettings().actionBars;
		expect(chooseLoadoutIcon(bars)).toBe(LOADOUT_ICONS[0]);
		expect(chooseLoadoutIcon(bars)).toBe(LOADOUT_ICONS.at(-1));
	});
	it("excludes icons saved across every character bar", () => {
		const bars = barsUsing(LOADOUT_ICONS.slice(0, -1));
		expect(chooseLoadoutIcon(bars)).toBe(LOADOUT_ICONS.at(-1));
	});
	it("permits a random reused icon when the entire palette is saved", () => {
		vi.spyOn(Math, "random").mockReturnValue(1 - Number.EPSILON);
		expect(chooseLoadoutIcon(barsUsing(LOADOUT_ICONS))).toBe(
			LOADOUT_ICONS.at(-1),
		);
	});
});
