import { describe, expect, it } from "vitest";
import {
	landblockLayerToSceneBundleKey,
	sceneEntityKey,
	SceneGraph,
	spawnedSceneBundleKey,
} from ".";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { Quat, Vec3 } from "../math/types";

const camera = {
	far: 800,
	fov: 90,
	near: 0.5,
	position: Vec3.zero(),
	rotation: Quat.identity(),
};

describe("SceneGraph", () => {
	it("keeps static-derived dynamic entities under the static bundle", () => {
		const scene = new SceneGraph();
		const bundleKey = landblockLayerToSceneBundleKey(
			"0001",
			LandblockLayerKind.Buildings,
		);
		const staticEntity = sceneEntityKey("building/1");
		const dynamicEntity = sceneEntityKey("weenie/1");

		scene.createStaticBundle(bundleKey);
		scene.createStaticEntity(bundleKey, staticEntity);
		scene.createDynamicEntity(bundleKey, dynamicEntity, "static-derived");

		expect(scene.updateVisibility(camera).entityKeys).toEqual([
			staticEntity,
			dynamicEntity,
		]);
	});

	it("gives a spawned dynamic entity its own bundle", () => {
		const scene = new SceneGraph();
		const bundleKey = spawnedSceneBundleKey("entity-1");
		const entityKey = sceneEntityKey("spawned/entity-1");

		scene.createDynamicBundle(bundleKey);
		scene.createDynamicEntity(bundleKey, entityKey, "runtime-spawned");

		expect(scene.updateVisibility(camera).entityKeys).toEqual([entityKey]);
	});

	it("replaces a bundle and removes its old entities", () => {
		const scene = new SceneGraph();
		const bundleKey = landblockLayerToSceneBundleKey(
			"0001",
			LandblockLayerKind.Objects,
		);

		scene.createStaticBundle(bundleKey);
		scene.createStaticEntity(bundleKey, sceneEntityKey("objects/old"));
		scene.createStaticBundle(bundleKey);

		expect(scene.updateVisibility(camera).entityKeys).toEqual([]);
	});

	it("requires a bundle before creating an entity", () => {
		const scene = new SceneGraph();

		expect(() =>
			scene.createDynamicEntity(
				spawnedSceneBundleKey("missing"),
				sceneEntityKey("spawned/missing"),
				"runtime-spawned",
			),
		).toThrow("without bundle");
	});
});
