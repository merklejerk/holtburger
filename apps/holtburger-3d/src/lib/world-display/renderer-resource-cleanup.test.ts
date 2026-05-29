import { describe, expect, it } from "vitest";

import { RendererResourceCleanupCoordinator } from "./renderer-resource-cleanup";
import {
	RendererResourceGraph,
	atlasGenerationGraphNodeKey,
	materialDecisionGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	staticBatchGraphNodeKey,
	type RendererResourceGraphDisposalCandidate,
	type RendererResourceGraphNodeKind,
} from "./renderer-resource-graph";

describe("renderer resource cleanup coordinator", () => {
	it("does not run until explicitly marked dirty", () => {
		const graph = createCleanupFixtureGraph();
		const disposed: string[] = [];
		const coordinator = new RendererResourceCleanupCoordinator({
			graph,
			ownersByNodeKind: createOwners(disposed),
		});

		expect(coordinator.flush()).toEqual({
			deletedNodeKeys: [],
			pendingNodeKeys: [],
		});
		expect(disposed).toEqual([]);
		expect(graph.hasNode(staticBatchGraphNodeKey("batch-1"))).toBe(true);
	});

	it("disposes concrete owner resources before deleting graph nodes", () => {
		const graph = createCleanupFixtureGraph();
		const disposed: string[] = [];
		const coordinator = new RendererResourceCleanupCoordinator({
			graph,
			ownersByNodeKind: createOwners(disposed),
		});

		coordinator.markDirty();
		const result = coordinator.flush();

		expect(result).toEqual({
			deletedNodeKeys: [
				atlasGenerationGraphNodeKey("atlas-1"),
				materialDecisionGraphNodeKey("mat-1"),
				sceneObjectGraphNodeKey("tree-1"),
				staticBatchGraphNodeKey("batch-1"),
			],
			pendingNodeKeys: [],
		});
		expect(disposed).toEqual([
			`${staticBatchGraphNodeKey("batch-1")}:exists`,
			`${atlasGenerationGraphNodeKey("atlas-1")}:exists`,
			`${sceneObjectGraphNodeKey("tree-1")}:exists`,
			`${materialDecisionGraphNodeKey("mat-1")}:exists`,
		]);
		expect(graph.hasNode(staticBatchGraphNodeKey("batch-1"))).toBe(false);
		expect(graph.hasNode(preparedAssetGraphNodeKey("gfx-obj/02000001"))).toBe(
			true,
		);
	});

	it("leaves retained nodes alone until their leases are released and cleanup is marked dirty again", () => {
		const graph = createCleanupFixtureGraph();
		const lease = graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");
		const disposed: string[] = [];
		const coordinator = new RendererResourceCleanupCoordinator({
			graph,
			ownersByNodeKind: createOwners(disposed),
		});

		coordinator.markDirty();
		expect(coordinator.flush()).toEqual({
			deletedNodeKeys: [
				atlasGenerationGraphNodeKey("atlas-1"),
				staticBatchGraphNodeKey("batch-1"),
			],
			pendingNodeKeys: [],
		});
		expect(graph.hasNode(sceneObjectGraphNodeKey("tree-1"))).toBe(true);

		graph.releaseLease(lease);
		coordinator.markDirty();
		expect(coordinator.flush()).toEqual({
			deletedNodeKeys: [
				materialDecisionGraphNodeKey("mat-1"),
				sceneObjectGraphNodeKey("tree-1"),
			],
			pendingNodeKeys: [],
		});
		expect(graph.hasNode(sceneObjectGraphNodeKey("tree-1"))).toBe(false);
	});
});

function createCleanupFixtureGraph(): RendererResourceGraph {
	const graph = new RendererResourceGraph();
	graph.transaction((draft) => {
		for (const node of [
			{
				key: preparedAssetGraphNodeKey("gfx-obj/02000001"),
				kind: "prepared-asset" as const,
			},
			{
				key: preparedAssetGraphNodeKey("material/08000001"),
				kind: "prepared-asset" as const,
			},
			{
				key: materialDecisionGraphNodeKey("mat-1"),
				kind: "material-decision" as const,
			},
			{
				key: sceneObjectGraphNodeKey("tree-1"),
				kind: "scene-object" as const,
			},
			{
				key: atlasGenerationGraphNodeKey("atlas-1"),
				kind: "atlas-generation" as const,
			},
			{
				key: staticBatchGraphNodeKey("batch-1"),
				kind: "static-batch" as const,
			},
		]) {
			draft.upsertNode(node);
		}
		draft.replaceDependencies(materialDecisionGraphNodeKey("mat-1"), [
			preparedAssetGraphNodeKey("material/08000001"),
		]);
		draft.replaceDependencies(sceneObjectGraphNodeKey("tree-1"), [
			preparedAssetGraphNodeKey("gfx-obj/02000001"),
			materialDecisionGraphNodeKey("mat-1"),
		]);
		draft.replaceDependencies(atlasGenerationGraphNodeKey("atlas-1"), [
			materialDecisionGraphNodeKey("mat-1"),
		]);
		draft.replaceDependencies(staticBatchGraphNodeKey("batch-1"), [
			atlasGenerationGraphNodeKey("atlas-1"),
			sceneObjectGraphNodeKey("tree-1"),
		]);
	});
	return graph;
}

function createOwners(
	disposed: string[],
): Partial<
	Record<
		RendererResourceGraphNodeKind,
		{
			disposeRendererResourceNode(
				candidate: RendererResourceGraphDisposalCandidate,
			): void;
		}
	>
> {
	return {
		"scene-object": {
			disposeRendererResourceNode(candidate) {
				disposed.push(`${candidate.nodeKey}:exists`);
			},
		},
		"material-decision": {
			disposeRendererResourceNode(candidate) {
				disposed.push(`${candidate.nodeKey}:exists`);
			},
		},
		"atlas-generation": {
			disposeRendererResourceNode(candidate) {
				disposed.push(`${candidate.nodeKey}:exists`);
			},
		},
		"static-batch": {
			disposeRendererResourceNode(candidate) {
				disposed.push(`${candidate.nodeKey}:exists`);
			},
		},
	};
}
