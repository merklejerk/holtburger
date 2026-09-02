import { describe, expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { Mat4 } from "../math/types";
import type { DynamicEntityView } from "../runtime/dynamic-entity-feed";
import type { ScenePlacement } from "../scene";
import { type MapBlip, type MapEntity, selectMapBlips } from "./map-blips";
import { type MapViewParameters, projectMapView } from "./map-view";

/** Landblock (1, 1): world origin x = 192, z = -192. */
const LANDBLOCK = "0x0101ffff";

function entity(
	overrides: {
		readonly guid?: number;
		readonly localX?: number;
		readonly localY?: number;
		readonly localZ?: number;
		readonly mapCategory?: DynamicEntityView["presentation"]["radar"]["category"];
		readonly behavior?:
			"ShowNever" | "ShowMovement" | "ShowAttacking" | "ShowAlways" | null;
		readonly hidden?: boolean;
	} = {},
): MapEntity {
	const transform = Mat4.identity();
	transform.m41 = overrides.localX ?? 0;
	transform.m42 = overrides.localY ?? 0;
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
		center: {
			worldX: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			worldZ: -OUTDOOR_LANDBLOCK_WORLD_SIZE,
		},
		viewDiameter: OUTDOOR_LANDBLOCK_WORLD_SIZE,
	};
}

function blips(
	entities: Iterable<MapEntity>,
	parameters: MapViewParameters,
	controlledEntityGuid: number | null,
): readonly MapBlip[] {
	return selectMapBlips(
		entities,
		projectMapView(parameters, 256, 256),
		controlledEntityGuid,
	);
}

describe("selectMapBlips", () => {
	it("places an entity from its live scene placement", () => {
		// Half a radius east and half a radius north of the landblock origin; north is -Z, so the
		// blip lands up and to the right.
		const selected = blips([entity({ localX: 96, localZ: -96 })], view(), null);

		expect(selected).toHaveLength(1);
		expect(selected[0]?.clipX).toBeCloseTo(1);
		expect(selected[0]?.clipY).toBeCloseTo(1);
		expect(selected[0]?.appearance).toEqual({
			category: "mob",
			heightOffsetMeters: 0,
		});
	});

	it("retains entity height relative to the map anchor", () => {
		const selected = blips(
			[entity({ localY: 18 })],
			{
				...view(),
				anchor: { ...view().anchor, worldY: 5 },
			},
			null,
		);

		expect(selected[0]?.appearance).toEqual({
			category: "mob",
			heightOffsetMeters: 13,
		});
	});

	it("distinguishes semantic categories that share one authored radar color", () => {
		const selected = blips(
			[
				entity({ guid: 1, mapCategory: "player" }),
				entity({ guid: 2, mapCategory: "npc" }),
				entity({ guid: 3, mapCategory: "lifestone" }),
			],
			view(),
			null,
		);

		expect(selected.map((blip) => blip.appearance.category)).toEqual([
			"player",
			"npc",
			"lifestone",
		]);
	});

	it("marks the controlled entity with its screen-relative heading", () => {
		const controlled = entity({ behavior: "ShowNever", hidden: true });

		const selected = blips([controlled], view(), 1);

		expect(selected).toHaveLength(1);
		expect(selected[0]).toMatchObject({
			appearance: { category: "controlled" },
			guid: 1,
			name: "Drudge",
		});
		const appearance = selected[0]?.appearance;
		expect(appearance?.category).toBe("controlled");
		if (appearance?.category === "controlled") {
			expect(appearance.headingRadians).toBeCloseTo(0);
		}
	});

	it.each(["ShowMovement", "ShowAttacking", "ShowAlways"] as const)(
		"honours retail's unconditional %s radar behaviour",
		(behavior) => {
			expect(blips([entity({ behavior })], view(), null)).toHaveLength(1);
		},
	);

	it.each([null, "ShowNever"] as const)(
		"hides retail radar behaviour %s",
		(behavior) => {
			expect(blips([entity({ behavior })], view(), null)).toHaveLength(0);
		},
	);

	it("skips hidden entities", () => {
		expect(blips([entity({ hidden: true })], view(), null)).toHaveLength(0);
	});

	it("drops entities outside the visible extent", () => {
		expect(blips([entity({ localX: 500 })], view(), null)).toHaveLength(0);
	});
});
