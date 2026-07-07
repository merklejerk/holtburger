import { describe, expect, it } from "vitest";
import { createStaticLayerOwnersFromDemand } from "../adapters/static-owner-demand-adapter";
import {
	createRuntimeEntityMaterializationOwner,
	createStaticAuthoredDynamicMaterializationOwner,
	createStaticLayerMaterializationOwner,
} from "./owner-id";
import { MaterializationOwnerRegistry } from "./owner-registry";
import { createRecordingOwnerTeardownPorts } from "./teardown-ports";

describe("MaterializationOwnerRegistry", () => {
	it("keeps owner currentness local to owner tokens", () => {
		const registry = new MaterializationOwnerRegistry();
		const owner = createStaticLayerMaterializationOwner({
			landblockId: 0xda55ffff,
			layerKind: "terrain",
		});

		const firstToken = registry.retain(owner);

		expect(registry.isCurrent({ ownerId: owner.id, token: firstToken })).toBe(
			true,
		);

		registry.evict(owner.id);

		expect(registry.isCurrent({ ownerId: owner.id, token: firstToken })).toBe(
			false,
		);

		const secondToken = registry.retain(owner);

		expect(secondToken).not.toBe(firstToken);
		expect(registry.isCurrent({ ownerId: owner.id, token: firstToken })).toBe(
			false,
		);
		expect(registry.isCurrent({ ownerId: owner.id, token: secondToken })).toBe(
			true,
		);
	});

	it("rejects stale artifact installation after eviction", () => {
		const registry = new MaterializationOwnerRegistry();
		const owner = createRuntimeEntityMaterializationOwner("dynamic:test");
		const token = registry.retain(owner);

		registry.evict(owner.id);

		expect(() =>
			registry.requireCurrent({
				ownerId: owner.id,
				subject: "fixture artifact",
				token,
			}),
		).toThrow(
			"fixture artifact is stale for owner runtime-entity:dynamic:test.",
		);
	});

	it("derives static owners from existing demand planning through an adapter", () => {
		const owners = createStaticLayerOwnersFromDemand({
			demand: {
				location: {
					kind: "outdoor-anchor",
					landblockId: 0xda55ffff,
				},
				lod: {
					buildings: 0,
					envCells: 0,
					explicitObjects: -1,
					generatedScenery: -1,
					terrain: 0,
				},
			},
			revision: 42,
		});

		expect(owners.map((owner) => owner.id)).toEqual([
			"static-layer:terrain:0xda55ffff",
			"static-layer:outdoor-buildings:0xda55ffff",
			"static-layer:env-cell-system:0xda55ffff",
		]);
	});

	it("models static-authored dynamic owners as children of static layer owners", () => {
		const parent = createStaticLayerMaterializationOwner({
			landblockId: 0xda55ffff,
			layerKind: "outdoor-generated-scenery",
		});
		const child = createStaticAuthoredDynamicMaterializationOwner({
			childId: "weenie:0200024b",
			parentStaticLayerOwnerId: parent.id,
		});

		expect(child).toMatchObject({
			childId: "weenie:0200024b",
			kind: "static-authored-dynamic",
			parentStaticLayerOwnerId: parent.id,
		});
	});

	it("keeps static renderer, scene-query, and runtime-entity teardown as explicit ports", () => {
		const ports = createRecordingOwnerTeardownPorts();
		const staticOwner = createStaticLayerMaterializationOwner({
			landblockId: 0xda55ffff,
			layerKind: "env-cell-system",
		});
		const runtimeOwner =
			createRuntimeEntityMaterializationOwner("dynamic:fixture");

		ports.staticLayers.teardownStaticLayer(staticOwner);
		ports.sceneQuery.teardownStaticLayerQuery(staticOwner);
		ports.runtimeEntities.teardownRuntimeEntity(runtimeOwner);

		expect(ports.calls).toEqual([
			{
				kind: "static-layer-renderer",
				landblockId: 0xda55ffff,
				layerKind: "env-cell-system",
				ownerId: "static-layer:env-cell-system:0xda55ffff",
			},
			{
				kind: "static-layer-query",
				landblockId: 0xda55ffff,
				layerKind: "env-cell-system",
				ownerId: "static-layer:env-cell-system:0xda55ffff",
			},
			{
				dynamicEntityId: "dynamic:fixture",
				kind: "runtime-entity",
				ownerId: "runtime-entity:dynamic:fixture",
			},
		]);
	});
});
