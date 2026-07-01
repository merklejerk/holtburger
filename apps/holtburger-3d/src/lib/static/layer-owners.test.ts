import { describe, expect, it } from "vitest";
import type {
	LayerOwnerKey,
	LayerOwnerState,
	StaticScopeOwnerKey,
} from "./contracts";
import {
	createLayerOwnerKeyForStaticScope,
	createLayerOwnerKeyId,
	reconcileLayerOwners,
} from "./layer-owners";

describe("layer owners", () => {
	it("maps split static domains to durable layer owner keys", () => {
		expect(
			createLayerOwnerKeyForStaticScope(
				createScope("outdoor-explicit-objects"),
			),
		).toEqual({
			kind: "outdoor-explicit-objects",
			landblockId: 0xda55ffff,
		});
		expect(
			createLayerOwnerKeyForStaticScope(
				createScope("outdoor-generated-scenery"),
			),
		).toEqual({
			kind: "outdoor-generated-scenery",
			landblockId: 0xda55ffff,
		});
		expect(
			createLayerOwnerKeyForStaticScope(createScope("outdoor-terrain")),
		).toEqual({
			kind: "terrain",
			landblockId: 0xda55ffff,
		});
		expect(
			createLayerOwnerKeyForStaticScope(createScope("env-cell-system")),
		).toEqual({
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		});
	});

	it("keeps owner identity independent from work revision ids", () => {
		const key = createLayerOwnerKeyForStaticScope(
			createScope("outdoor-generated-scenery"),
		);

		expect(createLayerOwnerKeyId(key)).toBe(
			"outdoor-generated-scenery:0xda55ffff",
		);
		expect(createLayerOwnerKeyId(key)).not.toContain("revision");
		expect(createLayerOwnerKeyId(key)).not.toContain("work");
	});

	it("classifies retained, added, evicted, and unchanged owners", () => {
		const previous = [
			createState({ kind: "terrain", landblockId: 0xda55ffff }),
			createState({ kind: "outdoor-buildings", landblockId: 0xda55ffff }),
			createState({
				kind: "outdoor-generated-scenery",
				landblockId: 0xda55ffff,
			}),
		];
		const desired: LayerOwnerKey[] = [
			{ kind: "terrain", landblockId: 0xda55ffff },
			{ kind: "outdoor-explicit-objects", landblockId: 0xda55ffff },
			{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
		];

		expect(reconcileLayerOwners(previous, desired)).toEqual({
			added: [{ kind: "outdoor-explicit-objects", landblockId: 0xda55ffff }],
			evicted: [{ kind: "outdoor-buildings", landblockId: 0xda55ffff }],
			retained: [
				{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
				{ kind: "terrain", landblockId: 0xda55ffff },
			],
			unchanged: [
				{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
				{ kind: "terrain", landblockId: 0xda55ffff },
			],
		});
	});
});

function createScope(
	domain: StaticScopeOwnerKey["domain"],
): StaticScopeOwnerKey {
	return {
		domain,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
	};
}

function createState(key: LayerOwnerKey): LayerOwnerState {
	return {
		key,
		lifecycle: "materialized",
		revision: 7,
	};
}
