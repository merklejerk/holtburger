import { describe, expect, it } from "vitest";
import type { StaticObjectLayerArtifact } from "../commit/artifacts";
import type { GeometryManager } from "../geometry/geometry-manager";
import type { SceneGraph, SceneNodeId } from "../scene";
import type { StaticInstanceStreamManager } from "./static-instance-stream-manager";
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
			instances as unknown as StaticInstanceStreamManager<string>,
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
			instances as unknown as StaticInstanceStreamManager<string>,
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

	it("keeps all outdoor-static owners and culling groups independent", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const instances = new FixtureInstances();
		const system = new StaticObjectSystem<
			"buildings" | "objects" | "generated",
			string
		>(
			scene as unknown as SceneGraph,
			geometry as unknown as GeometryManager<string>,
			instances as unknown as StaticInstanceStreamManager<string>,
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
		system.replaceObjects(
			"generated",
			revision(1),
			artifact("generated"),
			LandblockLayerKind.Generated,
		);
		system.evict("buildings", revision(1));

		expect(scene.live).toEqual(["node:1", "node:2", "node:3"]);
		system.evict("generated", revision(1));
		expect(scene.live).toEqual(["node:1", "node:2"]);
		system.evict("objects", revision(1));

		expect(scene.cullingGroups).toEqual([
			LandblockLayerKind.Buildings,
			LandblockLayerKind.Objects,
			LandblockLayerKind.Generated,
		]);
		expect(scene.live).toEqual(["node:1"]);
		expect(geometry.dropped).toEqual([
			"resource:generated:1",
			"resource:objects:1",
		]);
	});

	it("publishes and evicts every independently cullable object in one layer", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const instances = new FixtureInstances();
		const system = new StaticObjectSystem<"generated", string>(
			scene as unknown as SceneGraph,
			geometry as unknown as GeometryManager<string>,
			instances as unknown as StaticInstanceStreamManager<string>,
			(_, revision) => `resource:${revision}`,
		);
		const clustered = artifact("clustered");
		const object = clustered.objects[0]!;

		system.replaceObjects(
			"generated",
			revision(1),
			{ ...clustered, objects: [object, { ...object }] },
			LandblockLayerKind.Generated,
		);

		expect(scene.live).toEqual(["node:1", "node:2"]);
		expect(scene.cullingGroups).toEqual([
			LandblockLayerKind.Generated,
			LandblockLayerKind.Generated,
		]);

		system.evict("generated", revision(1));
		expect(scene.live).toEqual([]);
	});
});

function artifact(id: string): StaticObjectLayerArtifact {
	return {
		geometryDiagnostics: {
			bakedFallbackRangeCount: 0,
			bakedGeometryBytes: 0,
			geometryWorkerDurationMs: 0,
			instancedGeometryBytes: 0,
			staticFragmentBytes: 0,
			staticFragmentCohortCount: 0,
			staticFragmentCount: 0,
			staticFragmentDrawUnitCount: 0,
			staticFragmentInstanceCount: 0,
			sourceMaterialSlotCount: 0,
			sourcePartCount: 0,
			sourceRangeCount: 0,
			sourceResidentCount: 0,
			strategy: "empty",
			transparentTemplateBytes: 0,
			transparentTemplateCohortCount: 0,
			transparentTemplateInstanceCount: 0,
		},
		geometry: [],
		instanceStreams: [],
		objects: [
			{
				localBounds:
					{} as StaticObjectLayerArtifact["objects"][number]["localBounds"],
				placement:
					{} as StaticObjectLayerArtifact["objects"][number]["placement"],
				renderable: { drawUnits: [], frameStreamedInstances: [] },
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
