import { describe, expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { Mat4 } from "../math/types";
import type { DynamicEntityView } from "../runtime/dynamic-entity-feed";
import type { ScenePlacement } from "../scene";
import { type MapEntity, selectMapBlips } from "./map-blips";
import type { MapViewParameters } from "./map-view";

/** Landblock (1, 1): world origin x = 192, z = -192. */
const LANDBLOCK = "0x0101ffff";

function entity(
	overrides: {
		readonly guid?: number;
		readonly localX?: number;
		readonly localZ?: number;
		readonly mapCategory?: DynamicEntityView["presentation"]["radar"]["category"];
		readonly behavior?:
			"ShowNever" | "ShowMovement" | "ShowAttacking" | "ShowAlways" | null;
		readonly hidden?: boolean;
	} = {},
): MapEntity {
	const transform = Mat4.identity();
	transform.m41 = overrides.localX ?? 0;
	transform.m43 = overrides.localZ ?? 0;
	return {
		placement: {
			envCellId: null,
			landblockId: LANDBLOCK,
			localTransform: transform,
		} as ScenePlacement,
		view: {
			identity: { guid: overrides.guid ?? 1, wcid: 42 },
			display: { name: "Drudge", level: null },
			presentation: {
				entityClass: "other",
				radar: {
					category: overrides.mapCategory ?? "mob",
					behavior:
						overrides.behavior === undefined
							? "ShowAlways"
							: overrides.behavior,
				},
			},
			physics: { hidden: overrides.hidden ?? false },
		} as unknown as DynamicEntityView,
	};
}

function view(): MapViewParameters {
	return {
		anchor: {
			headingRadians: 0,
			residency: null,
			// Centred on the landblock's own origin corner.
			worldX: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			worldY: 0,
			worldZ: -OUTDOOR_LANDBLOCK_WORLD_SIZE,
		},
		viewDiameter: OUTDOOR_LANDBLOCK_WORLD_SIZE,
	};
}

describe("selectMapBlips", () => {
	it("places an entity from its live scene placement", () => {
		// Half a radius east and half a radius north of the landblock origin; north is -Z, so the
		// blip lands up and to the right.
		const blips = selectMapBlips(
			[entity({ localX: 96, localZ: -96 })],
			view(),
			256,
			256,
			null,
		);

		expect(blips).toHaveLength(1);
		expect(blips[0]?.clipX).toBeCloseTo(1);
		expect(blips[0]?.clipY).toBeCloseTo(1);
		expect(blips[0]?.appearance).toEqual({ category: "mob" });
	});

	it("distinguishes semantic categories that share one authored radar color", () => {
		const blips = selectMapBlips(
			[
				entity({ guid: 1, mapCategory: "player" }),
				entity({ guid: 2, mapCategory: "npc" }),
				entity({ guid: 3, mapCategory: "lifestone" }),
			],
			view(),
			256,
			256,
			null,
		);

		expect(blips.map((blip) => blip.appearance)).toEqual([
			{ category: "player" },
			{ category: "npc" },
			{ category: "lifestone" },
		]);
	});

	it("marks the controlled entity with its screen-relative heading", () => {
		const controlled = entity({ behavior: "ShowNever", hidden: true });

		const blips = selectMapBlips([controlled], view(), 256, 256, 1);

		expect(blips).toHaveLength(1);
		expect(blips[0]).toMatchObject({
			appearance: { category: "controlled" },
			guid: 1,
			name: "Drudge",
		});
		const appearance = blips[0]?.appearance;
		expect(appearance?.category).toBe("controlled");
		if (appearance?.category === "controlled") {
			expect(appearance.headingRadians).toBeCloseTo(0);
		}
	});

	it.each(["ShowMovement", "ShowAttacking", "ShowAlways"] as const)(
		"honours retail's unconditional %s radar behaviour",
		(behavior) => {
			expect(
				selectMapBlips([entity({ behavior })], view(), 256, 256, null),
			).toHaveLength(1);
		},
	);

	it.each([null, "ShowNever"] as const)(
		"hides retail radar behaviour %s",
		(behavior) => {
			expect(
				selectMapBlips([entity({ behavior })], view(), 256, 256, null),
			).toHaveLength(0);
		},
	);

	it("skips hidden entities", () => {
		expect(
			selectMapBlips([entity({ hidden: true })], view(), 256, 256, null),
		).toHaveLength(0);
	});

	it("drops entities outside the visible extent", () => {
		expect(
			selectMapBlips([entity({ localX: 500 })], view(), 256, 256, null),
		).toHaveLength(0);
	});
});
