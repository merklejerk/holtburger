import { describe, expect, it } from "vitest";
import type { StaticObjectLayerArtifact } from "../commit/artifacts";
import type { GeometryManager } from "../geometry/geometry-manager";
import type { SceneGraph, SceneNodeId } from "../scene";
import type { InstanceStreamManager } from "./instance-stream-manager";
import { StaticObjectSystem } from "./static-object-system";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { SceneInterestRevision } from "../runtime/scene-availability";

describe("StaticObjectSystem", () => {
	it("retains the visible revision when staging a replacement fails", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const instances = new FixtureInstances();
		const system = new StaticObjectSystem<"buildings", string>(
			scene as unknown as SceneGraph,
			geometry as unknown as GeometryManager<string>,
			instances as unknown as InstanceStreamManager<string>,
			(_, revision) => `resource:${revision}`,
		);

		system.replaceObjects(
			"buildings",
			revision(1),
			artifact("first"),
			LandblockLayerKind.Buildings,
		);
		scene.failNextCreate = true;

		expect(() =>
			system.replaceObjects(
				"buildings",
				revision(2),
				artifact("second"),
				LandblockLayerKind.Buildings,
			),
		).toThrow("scene create failed");

		expect(scene.live).toEqual(["node:1"]);
		expect(geometry.dropped).toEqual(["resource:2"]);
		expect(instances.dropped).toEqual(["resource:2"]);
	});

	it("does not evict a later visible revision", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const instances = new FixtureInstances();
		const system = new StaticObjectSystem<"buildings", string>(
			scene as unknown as SceneGraph,
			geometry as unknown as GeometryManager<string>,
			instances as unknown as InstanceStreamManager<string>,
			(_, revision) => `resource:${revision}`,
		);
		system.replaceObjects(
			"buildings",
			revision(2),
			artifact("current"),
			LandblockLayerKind.Buildings,
		);

		system.evict("buildings", revision(1));

		expect(scene.live).toEqual(["node:1"]);
		expect(geometry.dropped).toEqual([]);
	});

	it("keeps building and object owners in independent culling groups", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const instances = new FixtureInstances();
		const system = new StaticObjectSystem<"buildings" | "objects", string>(
			scene as unknown as SceneGraph,
			geometry as unknown as GeometryManager<string>,
			instances as unknown as InstanceStreamManager<string>,
			(owner, revision) => `resource:${owner}:${revision}`,
		);

		system.replaceObjects(
			"buildings",
			revision(2),
			artifact("buildings"),
			LandblockLayerKind.Buildings,
		);
		system.replaceObjects(
			"objects",
			revision(1),
			artifact("objects"),
			LandblockLayerKind.Objects,
		);
		system.evict("buildings", revision(1));

		expect(scene.live).toEqual(["node:1", "node:2"]);
		system.evict("objects", revision(1));

		expect(scene.cullingGroups).toEqual([
			LandblockLayerKind.Buildings,
			LandblockLayerKind.Objects,
		]);
		expect(scene.live).toEqual(["node:1"]);
		expect(geometry.dropped).toEqual(["resource:objects:1"]);
	});
});

function artifact(id: string): StaticObjectLayerArtifact {
	return {
		bakeDiagnostics: {
			additiveRangeCount: 0,
			bakedRangeCount: 0,
			geometryBytes: 0,
			geometryWorkerDurationMs: 0,
			sourceMaterialSlotCount: 0,
			sourceRangeCount: 0,
			transparentRangeCount: 0,
		},
		geometry: [],
		instanceStreams: [],
		objects: [
			{
				localBounds:
					{} as StaticObjectLayerArtifact["objects"][number]["localBounds"],
				placement:
					{} as StaticObjectLayerArtifact["objects"][number]["placement"],
				renderable: { drawUnits: [] },
			},
		],
		resourceNamespace:
			`static-install:${id}` as StaticObjectLayerArtifact["resourceNamespace"],
		textureRequirements: [],
	};
}

function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

class FixtureScene {
	readonly cullingGroups: string[] = [];
	readonly live: string[] = [];
	failNextCreate = false;
	#createCount = 0;

	createNode(input: { readonly cullingGroup: string }): SceneNodeId {
		if (this.failNextCreate) {
			this.failNextCreate = false;
			throw new Error("scene create failed");
		}
		this.#createCount += 1;
		const node = `node:${this.#createCount}` as SceneNodeId;
		this.live.push(node);
		this.cullingGroups.push(input.cullingGroup);
		return node;
	}

	destroyNode(node: SceneNodeId): void {
		const index = this.live.indexOf(node);
		if (index >= 0) this.live.splice(index, 1);
	}
}

class FixtureGeometry {
	readonly dropped: string[] = [];
	dropOwner(owner: string): void {
		this.dropped.push(owner);
	}
	reserveKeys(): void {}
	upsertGeometry(): void {}
}

class FixtureInstances {
	readonly dropped: string[] = [];
	dropOwner(owner: string): void {
		this.dropped.push(owner);
	}
	publish(): void {}
	reserveKeys(): void {}
}
