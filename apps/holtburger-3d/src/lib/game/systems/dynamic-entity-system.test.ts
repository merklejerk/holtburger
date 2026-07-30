import { describe, expect, it } from "vitest";
import type { DynamicEntityCommit } from "../commit/types";
import type { WorldObjectGuid } from "../game-types";
import type {
	ResolvedEntityAttachment,
	ResolvedResidentIdentity,
} from "../resolution/landblock-layer";
import type { GeometryManager } from "../geometry/geometry-manager";
import { createTranslationMat4, getMat4Translation } from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ParentLocation,
	ResolvedAttachPoint,
	ResolvedGeometry,
	ResolvedObjectPresentation,
} from "../resolution/presentation";
import { SceneGraph } from "../scene";
import {
	DynamicEntitySystem,
	type DynamicPreparedPresentation,
	type DynamicVisualPreparer,
} from "./dynamic-entity-system";

const LANDBLOCK = "0x0001ffff";
const OTHER_LANDBLOCK = "0x0002ffff";

describe("DynamicEntitySystem attachment", () => {
	it("positions an attached entity by its parent's attach part and offset", () => {
		const { scene, system } = createSystem();
		const wielder = system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 1, new Vec3(0, 0, 3))],
				partTransforms: [
					Mat4.identity(),
					createTranslationMat4(new Vec3(0, 2, 0)),
				],
				placement: placementAt(new Vec3(10, 0, 0)),
			}),
		);
		const item = system.install("item", worldResident("item"));

		system.attachEntity(item, wielder, "right-hand");

		// wielder root (10,0,0) ⊗ hand part (0,2,0) ⊗ attach offset (0,0,3)
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(10, 2, 3));
	});

	it("refuses an attach point the parent does not offer", () => {
		const { system } = createSystem();
		const wielder = system.install("wielder", worldResident("wielder"));
		const item = system.install("item", worldResident("item"));

		expect(() => system.attachEntity(item, wielder, "left-weapon")).toThrow(
			"offers no left-weapon attach point",
		);
	});

	it("refuses an attach point naming a part the parent has no node for", () => {
		const { system } = createSystem();
		const wielder = system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("belt", 7, Vec3.zero())],
			}),
		);
		const item = system.install("item", worldResident("item"));

		expect(() => system.attachEntity(item, wielder, "belt")).toThrow(
			"no node for attach part 7",
		);
	});

	it("re-attaches to a different location without reinstalling the entity", () => {
		const { scene, system } = createSystem();
		const wielder = system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [
					attachPoint("right-hand", 0, new Vec3(1, 0, 0)),
					attachPoint("left-weapon", 0, new Vec3(-1, 0, 0)),
				],
			}),
		);
		const item = system.install("item", worldResident("item"));

		system.attachEntity(item, wielder, "right-hand");
		system.detachEntity(item, placementAt(Vec3.zero()));
		system.attachEntity(item, wielder, "left-weapon");

		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(-1, 0, 0));
	});

	it("releases attached children when their parent is torn down, leaving them where they were", () => {
		const { scene, system } = createSystem();
		const wielder = system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
				placement: placementAt(new Vec3(10, 0, 0)),
			}),
		);
		const item = system.install("item", worldResident("item"));
		system.attachEntity(item, wielder, "right-hand");

		system.removeOwner("wielder");

		expect(scene.getNode(item)).toMatchObject({
			landblockId: LANDBLOCK,
			parentId: null,
		});
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(11, 2, 3));
	});

	it("attaches on install when the parent is already installed", () => {
		const { scene, system } = createSystem();
		system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
				placement: placementAt(new Vec3(10, 0, 0)),
			}),
		);
		const item = system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
			}),
		);

		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(11, 2, 3));
	});

	it("retains an attachment whose parent has not installed yet and applies it on arrival", () => {
		const { scene, system } = createSystem();
		const item = system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
				placement: placementAt(new Vec3(99, 0, 0)),
			}),
		);

		// Nothing to attach to yet, so it stands in the world under its own placement.
		expect(scene.getNode(item)).toMatchObject({ parentId: null });
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(99, 0, 0));

		system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
				placement: placementAt(new Vec3(10, 0, 0)),
			}),
		);

		expect(scene.getNode(item)).not.toMatchObject({ parentId: null });
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(11, 2, 3));
	});

	it("drops a retained attachment when the entity waiting on it is removed", () => {
		const { scene, system } = createSystem();
		system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
			}),
		);
		system.removeOwner("item");

		const wielder = system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
			}),
		);

		expect(scene.getNode(wielder)).toMatchObject({ parentId: null });
	});

	it("attaches across landblocks, as a pickup does", () => {
		const { scene, system } = createSystem();
		system.install(
			"wielder",
			worldResident("wielder", {
				attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
				placement: placementAt(new Vec3(10, 0, 0)),
			}),
		);
		// The item was lying in a different landblock when the server announced the attachment.
		const item = system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
				placement: placementAt(new Vec3(99, 0, 0), OTHER_LANDBLOCK),
			}),
		);

		// A world GUID is landblock-independent, so the item inherits its wielder's residency.
		expect(scene.getResolvedPlacement(item)).toMatchObject({
			landblockId: LANDBLOCK,
		});
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(11, 2, 3));
	});

	it("returns children to a reinstalled parent instead of leaving them floating", () => {
		const { scene, system } = createSystem();
		const wielderCommit = worldResident("wielder", {
			attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
			placement: placementAt(new Vec3(10, 0, 0)),
		});
		system.install("wielder", wielderCommit);
		const item = system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
			}),
		);

		// Reinstalling the same owner tears the wielder down and stands it back up.
		system.install("wielder", wielderCommit);

		expect(scene.getNode(item)).not.toMatchObject({ parentId: null });
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(11, 2, 3));
	});

	it("does not re-attach an entity that was intentionally detached", () => {
		const { scene, system } = createSystem();
		const wielderCommit = worldResident("wielder", {
			attachPoints: [attachPoint("right-hand", 0, new Vec3(1, 2, 3))],
		});
		system.install("wielder", wielderCommit);
		const item = system.install(
			"item",
			worldResident("item", {
				attachment: {
					location: "right-hand",
					parent: "wielder",
					placement: 0,
				},
			}),
		);

		system.detachEntity(item, placementAt(new Vec3(50, 0, 0)));
		system.install("wielder", wielderCommit);

		expect(scene.getNode(item)).toMatchObject({ parentId: null });
		expect(resolvedTranslation(scene, item)).toEqual(new Vec3(50, 0, 0));
	});
});

function createSystem() {
	const scene = new SceneGraph();
	const system = new DynamicEntitySystem<string>(
		scene,
		new FixtureGeometry() as unknown as GeometryManager<string>,
		new FixturePreparer(),
	);
	return { scene, system };
}

function resolvedTranslation(scene: SceneGraph, nodeId: string): Vec3 {
	const placement = scene.getResolvedPlacement(nodeId as never);
	if (!placement) throw new Error(`Scene node ${nodeId} has no placement.`);
	return getMat4Translation(placement.localToLandblock, Vec3.zero());
}

function placementAt(origin: Vec3, landblockId: string = LANDBLOCK) {
	return {
		envCellId: null,
		landblockId,
		localTransform: createTranslationMat4(origin),
	};
}

function attachPoint(
	location: ParentLocation,
	partIndex: number,
	offset: Vec3,
): ResolvedAttachPoint {
	return {
		location,
		offsetTransform: createTranslationMat4(offset),
		partIndex,
	};
}

interface ResidentOptions {
	readonly attachPoints?: readonly ResolvedAttachPoint[];
	readonly partTransforms?: readonly Mat4[];
	readonly placement?: ReturnType<typeof placementAt>;
}

/**
 * A server object, which is the only kind that can attach or be attached to.
 *
 * There is deliberately no authored-resident fixture here: an authored resident cannot express an
 * attachment at all, so it has nothing to exercise in this suite.
 */
function worldResident(
	guid: WorldObjectGuid,
	options: ResidentOptions & {
		readonly attachment?: ResolvedEntityAttachment;
	} = {},
): DynamicEntityCommit {
	const id = guid;
	const identity: ResolvedResidentIdentity = {
		kind: "world",
		guid,
		attachment: options.attachment ?? null,
	};
	const partTransforms = options.partTransforms ?? [Mat4.identity()];
	const presentation: ResolvedObjectPresentation = {
		effects: {
			animationId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		holdingLocations: new Map(
			(options.attachPoints ?? []).map((point) => [point.location, point]),
		),
		id: `presentation:${id}`,
		motion: null,
		parts: partTransforms.map((_, partIndex) => ({
			defaultScale: new Vec3(1, 1, 1),
			geometry: { bounds: null, id: `geometry:${id}` } as ResolvedGeometry,
			materials: [],
			partIndex,
		})),
		placementPoses: new Map([[0, { partTransforms, placementId: 0 }]]),
		selectionBounds: AABB3.zero(),
		sortingBounds: null,
		sourceAssetId: `0x0200000${id.length}`,
	};
	return {
		appearance: null,
		identity,
		localBounds: AABB3.zero(),
		placement: options.placement ?? placementAt(Vec3.zero()),
		presentation,
		scale: new Vec3(1, 1, 1),
	};
}

class FixtureGeometry {
	reserveKeys(): void {}
	upsertGeometry(): void {}
	dropOwner(): void {}
}

class FixturePreparer implements DynamicVisualPreparer {
	async prepare(): Promise<DynamicPreparedPresentation> {
		return { geometry: [], parts: [] };
	}
	async destroy(): Promise<void> {}
}
