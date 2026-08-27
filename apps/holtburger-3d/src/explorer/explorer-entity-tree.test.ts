import { describe, expect, it } from "vitest";

import { buildExplorerEntityTree } from "./explorer-entity-tree";
import {
	cellId,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";

describe("buildExplorerEntityTree", () => {
	it("nests each held child under its wearer in published order", () => {
		const tree = buildExplorerEntityTree([
			world(1),
			attached(2, 1),
			world(3),
			attached(4, 1),
		]);

		expect(tree.roots.map((root) => root.entity.identity.guid)).toEqual([1, 3]);
		expect(tree.roots[0]!.children.map((c) => c.identity.guid)).toEqual([2, 4]);
		expect(tree.roots[1]!.children).toEqual([]);
		expect(tree.orphans).toEqual([]);
	});

	it("surfaces a child whose wearer is absent instead of rehoming it", () => {
		const tree = buildExplorerEntityTree([world(1), attached(2, 99)]);

		expect(tree.roots).toHaveLength(1);
		expect(tree.roots[0]!.children).toEqual([]);
		expect(tree.orphans.map((entity) => entity.identity.guid)).toEqual([2]);
	});

	it("never treats an attached entity as a root", () => {
		const tree = buildExplorerEntityTree([attached(2, 1), world(1)]);

		expect(tree.roots.map((root) => root.entity.identity.guid)).toEqual([1]);
		expect(tree.roots[0]!.children.map((c) => c.identity.guid)).toEqual([2]);
	});
});

function world(guid: number): DynamicEntityView {
	return {
		...base(guid),
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			pose: {
				landblockId: cellId(0xda550001),
				coords: { x: 0, y: 0, z: 0 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			velocity: { x: 0, y: 0, z: 0 },
			acceleration: { x: 0, y: 0, z: 0 },
			omega: { x: 0, y: 0, z: 0 },
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
	};
}

function attached(guid: number, parent: number): DynamicEntityView {
	return {
		...base(guid),
		placement: {
			kind: "attached",
			parent,
			parentLocation: "right-hand",
			placement: "right-hand-combat",
		},
	};
}

function base(guid: number): Omit<DynamicEntityView, "placement"> {
	return {
		generation: 1,
		playingClip: null,
		identity: { guid, wcid: 42, name: "Entity" },
		presentation: {
			content: {
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
	};
}
