import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import {
	createRenderBatchCandidateRegistry,
	type RenderBatchCandidateBinding,
} from "./render-batch-candidates";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";

describe("render batch candidate registry", () => {
	it("selects a batch when any registered item key is visible", () => {
		const registry = createRenderBatchCandidateRegistry();
		const visibleObject = new Object3D();
		const hiddenObject = new Object3D();
		registry.register(
			binding("visible-static-batch", visibleObject, [
				key("tree"),
				key("rock"),
			]),
		);
		registry.register(binding("hidden-static-batch", hiddenObject, [key("hut")]));

		const selection = registry.selectCandidates({
			visibleItemKeys: new Set([key("rock")]),
		});

		expect([...selection.candidateBatchIds]).toEqual([
			"visible-static-batch",
		]);
		expect(selection.candidateObjects).toEqual([visibleObject]);
		expect(selection.counters.registeredBatchCount).toBe(2);
		expect(selection.counters.keyedBatchCount).toBe(2);
		expect(selection.counters.itemKeyMatchedBatchCount).toBe(1);
		expect(selection.counters.candidateBatchCount).toBe(1);
	});

	it("deduplicates represented item keys when a binding is registered", () => {
		const registry = createRenderBatchCandidateRegistry();
		registry.register(
			binding("duplicate-key-batch", new Object3D(), [
				key("tree"),
				key("tree"),
			]),
		);

		const selection = registry.selectCandidates({
			visibleItemKeys: new Set([key("tree")]),
		});

		expect(selection.counters.representedItemKeyCount).toBe(1);
		expect(selection.counters.itemKeyMatchedBatchCount).toBe(1);
	});

	it("fallback-includes batches with no item keys", () => {
		const registry = createRenderBatchCandidateRegistry();
		const object = new Object3D();
		registry.register(binding("unbound-batch", object, []));

		const selection = registry.selectCandidates({
			visibleItemKeys: new Set(),
		});

		expect([...selection.candidateBatchIds]).toEqual(["unbound-batch"]);
		expect(selection.candidateObjects).toEqual([object]);
		expect(selection.counters.unboundFallbackBatchCount).toBe(1);
		expect(selection.counters.fallbackReasonCount).toBe(1);
		expect(selection.fallbackReasonSamples).toEqual([
			"batch unbound-batch has no BVH item keys",
		]);
	});

	it("fallback-includes explicitly marked batches", () => {
		const registry = createRenderBatchCandidateRegistry();
		registry.register({
			...binding("explicit-fallback-batch", new Object3D(), [key("tree")]),
			fallbackReason: "static group contains an unkeyed part",
		});

		const selection = registry.selectCandidates({
			visibleItemKeys: new Set(),
		});

		expect([...selection.candidateBatchIds]).toEqual([
			"explicit-fallback-batch",
		]);
		expect(selection.counters.explicitFallbackBatchCount).toBe(1);
		expect(selection.fallbackReasonSamples).toEqual([
			"static group contains an unkeyed part",
		]);
	});

	it("fallback-includes keyed batches when the BVH query reports suspect data", () => {
		const registry = createRenderBatchCandidateRegistry();
		registry.register(binding("query-fallback-batch", new Object3D(), [key("tree")]));

		const selection = registry.selectCandidates({
			visibleItemKeys: new Set(),
			queryFallbackReasons: ["missing outdoor BVH"],
		});

		expect([...selection.candidateBatchIds]).toEqual([
			"query-fallback-batch",
		]);
		expect(selection.counters.queryFallbackBatchCount).toBe(1);
		expect(selection.counters.fallbackReasonCount).toBe(1);
	});

	it("updates and unregisters batch bindings by id", () => {
		const registry = createRenderBatchCandidateRegistry();
		const originalObject = new Object3D();
		const replacementObject = new Object3D();
		registry.register(binding("mutable-batch", originalObject, [key("tree")]));
		registry.register(
			binding("mutable-batch", replacementObject, [key("rock")]),
		);

		expect(registry.size).toBe(1);
		expect(registry.getObject("mutable-batch")).toBe(replacementObject);
		expect(
			[
				...registry.selectCandidates({
					visibleItemKeys: new Set([key("tree")]),
				}).candidateBatchIds,
			],
		).toEqual([]);
		expect(
			[
				...registry.selectCandidates({
					visibleItemKeys: new Set([key("rock")]),
				}).candidateBatchIds,
			],
		).toEqual(["mutable-batch"]);

		registry.unregister("mutable-batch");

		expect(registry.size).toBe(0);
		expect(registry.getObject("mutable-batch")).toBeNull();
	});
});

function binding(
	batchId: string,
	object: Object3D,
	itemKeys: readonly RenderBvhItemKey[],
): RenderBatchCandidateBinding {
	return {
		batchId,
		object,
		itemKeys,
	};
}

function key(instanceId: string): RenderBvhItemKey {
	return `outdoor-static:landblock:0203ffff:instance:${instanceId}`;
}
