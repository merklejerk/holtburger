import { describe, expect, it } from "vitest";

import {
	RendererResourceGraph,
	atlasGenerationGraphNodeKey,
	materialDecisionGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	staticBatchGraphNodeKey,
} from "./renderer-resource-graph";

describe("renderer resource graph", () => {
	it("derives transitive prepared-asset retention from leased scene and atlas nodes", () => {
		const graph = createFixtureGraph();
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene assembly");
		graph.leaseNode(atlasGenerationGraphNodeKey("atlas-1"), "atlas compaction");

		expect(graph.retainedPreparedAssetIds()).toEqual([
			"gfx-obj/02000001",
			"material/08000001",
			"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			"setup-appearance/02000001",
		]);
	});

	it("reports derived nodes as disposal candidates once their leases are released", () => {
		const graph = createFixtureGraph();
		const lease = graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");

		expect(graph.disposalCandidates().map((candidate) => candidate.nodeKey)).toEqual([
			atlasGenerationGraphNodeKey("atlas-1"),
			staticBatchGraphNodeKey("batch-1"),
		]);

		graph.releaseLease(lease);

		expect(graph.disposalCandidates().map((candidate) => candidate.nodeKey)).toEqual([
			atlasGenerationGraphNodeKey("atlas-1"),
			materialDecisionGraphNodeKey("mat-1"),
			sceneObjectGraphNodeKey("tree-1"),
			staticBatchGraphNodeKey("batch-1"),
		]);
	});

	it("keeps multiple lease owners explicit without reference-count ambiguity", () => {
		const graph = createFixtureGraph();
		const first = graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "visible scene");
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "debug picker");

		graph.releaseLease(first);

		expect(graph.retainedPreparedAssetIds()).toEqual([
			"gfx-obj/02000001",
			"material/08000001",
			"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			"setup-appearance/02000001",
		]);
		expect(
			graph.explainRetention("material/08000001").paths.map((path) => path.owner),
		).toEqual(["debug picker"]);
	});

	it("leaves the graph unchanged when a transaction fails", () => {
		const graph = createFixtureGraph();
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");

		expect(() =>
			graph.transaction((draft) => {
				draft.replaceDependencies(sceneObjectGraphNodeKey("tree-1"), [
					"missing-node",
				]);
			}),
		).toThrow(/unknown/);

		expect(graph.retainedPreparedAssetIds()).toEqual([
			"gfx-obj/02000001",
			"material/08000001",
			"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			"setup-appearance/02000001",
		]);
	});

	it("rejects cycles during direct dependency replacement and transactions", () => {
		const graph = createFixtureGraph();

		expect(() =>
			graph.replaceDependencies(materialDecisionGraphNodeKey("mat-1"), [
				sceneObjectGraphNodeKey("tree-1"),
			]),
		).toThrow(/cycle/);

		expect(() =>
			graph.transaction((draft) => {
				draft.replaceDependencies(atlasGenerationGraphNodeKey("atlas-1"), [
					staticBatchGraphNodeKey("batch-1"),
				]);
				draft.replaceDependencies(staticBatchGraphNodeKey("batch-1"), [
					atlasGenerationGraphNodeKey("atlas-1"),
				]);
			}),
		).toThrow(/cycle/);
	});

	it("publishes graph retention before visible scene state in one transaction", () => {
		const graph = new RendererResourceGraph();
		const visibleSceneObjectKeys: string[] = [];

		graph.transaction((draft) => {
			draft.upsertNode({
				key: preparedAssetGraphNodeKey("gfx-obj/02000001"),
				kind: "prepared-asset",
			});
			draft.upsertNode({
				key: sceneObjectGraphNodeKey("tree-1"),
				kind: "scene-object",
			});
			draft.replaceDependencies(sceneObjectGraphNodeKey("tree-1"), [
				preparedAssetGraphNodeKey("gfx-obj/02000001"),
			]);
			draft.leaseNode(sceneObjectGraphNodeKey("tree-1"), "visible scene");
			visibleSceneObjectKeys.push(sceneObjectGraphNodeKey("tree-1"));
		});

		expect(visibleSceneObjectKeys).toEqual([sceneObjectGraphNodeKey("tree-1")]);
		expect(graph.retainedPreparedAssetIds()).toEqual(["gfx-obj/02000001"]);
	});

	it("applies many node and dependency updates with one validation pass", () => {
		const graph = new RendererResourceGraph();
		graph.applyBatchUpdate({
			nodes: [
				{ key: preparedAssetGraphNodeKey("a"), kind: "prepared-asset" },
				{ key: preparedAssetGraphNodeKey("b"), kind: "prepared-asset" },
				{ key: sceneObjectGraphNodeKey("first"), kind: "scene-object" },
				{ key: sceneObjectGraphNodeKey("second"), kind: "scene-object" },
			],
			dependencyReplacements: [
				{
					nodeKey: sceneObjectGraphNodeKey("first"),
					dependencyKeys: [preparedAssetGraphNodeKey("a")],
				},
				{
					nodeKey: sceneObjectGraphNodeKey("second"),
					dependencyKeys: [preparedAssetGraphNodeKey("b")],
				},
			],
		});
		graph.leaseNode(sceneObjectGraphNodeKey("first"), "first");
		graph.leaseNode(sceneObjectGraphNodeKey("second"), "second");

		expect(graph.retainedPreparedAssetIds()).toEqual(["a", "b"]);
	});

	it("rejects cycles from batch updates without committing partial state", () => {
		const graph = new RendererResourceGraph();

		expect(() =>
			graph.applyBatchUpdate({
				nodes: [
					{ key: sceneObjectGraphNodeKey("first"), kind: "scene-object" },
					{ key: sceneObjectGraphNodeKey("second"), kind: "scene-object" },
				],
				dependencyReplacements: [
					{
						nodeKey: sceneObjectGraphNodeKey("first"),
						dependencyKeys: [sceneObjectGraphNodeKey("second")],
					},
					{
						nodeKey: sceneObjectGraphNodeKey("second"),
						dependencyKeys: [sceneObjectGraphNodeKey("first")],
					},
				],
			}),
		).toThrow(/cycle/);

		expect(graph.hasNode(sceneObjectGraphNodeKey("first"))).toBe(false);
	});

	it("returns deterministic retained ids, candidates, and explanations", () => {
		const graph = new RendererResourceGraph();
		graph.transaction((draft) => {
			for (const node of [
				{ key: preparedAssetGraphNodeKey("z"), kind: "prepared-asset" as const },
				{ key: preparedAssetGraphNodeKey("a"), kind: "prepared-asset" as const },
				{ key: sceneObjectGraphNodeKey("b"), kind: "scene-object" as const },
				{ key: sceneObjectGraphNodeKey("a"), kind: "scene-object" as const },
			]) {
				draft.upsertNode(node);
			}
			draft.replaceDependencies(sceneObjectGraphNodeKey("b"), [
				preparedAssetGraphNodeKey("z"),
			]);
			draft.replaceDependencies(sceneObjectGraphNodeKey("a"), [
				preparedAssetGraphNodeKey("a"),
			]);
			draft.leaseNode(sceneObjectGraphNodeKey("b"), "z-owner");
			draft.leaseNode(sceneObjectGraphNodeKey("a"), "a-owner");
		});

		expect(graph.retainedPreparedAssetIds()).toEqual(["a", "z"]);
		expect(graph.disposalCandidates()).toEqual([]);
		expect(
			graph.explainRetention(preparedAssetGraphNodeKey("z")).paths.map((path) => ({
				owner: path.owner,
				path: path.path,
			})),
		).toEqual([
			{
				owner: "z-owner",
				path: [sceneObjectGraphNodeKey("b"), preparedAssetGraphNodeKey("z")],
			},
		]);
	});

	it("uses canonical prepared-asset nodes rather than duplicate semantic texture nodes", () => {
		const graph = createFixtureGraph();
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");

		expect(
			graph.explainRetention(
				"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			).targetKey,
		).toBe(
			preparedAssetGraphNodeKey(
				"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			),
		);
		expect(graph.hasNode("render-surface/05000001")).toBe(false);
	});

	it("deletes only unleased, unreachable derived nodes without dependents", () => {
		const graph = createFixtureGraph();

		graph.deleteDerivedNode(staticBatchGraphNodeKey("batch-1"));

		expect(graph.hasNode(staticBatchGraphNodeKey("batch-1"))).toBe(false);
		expect(() =>
			graph.deleteDerivedNode(materialDecisionGraphNodeKey("mat-1")),
		).toThrow(/dependents/);
	});

	it("rejects deletion for leased, reachable, unknown, and prepared nodes", () => {
		const graph = createFixtureGraph();
		graph.leaseNode(staticBatchGraphNodeKey("batch-1"), "active batch store");

		expect(() =>
			graph.deleteDerivedNode(staticBatchGraphNodeKey("batch-1")),
		).toThrow(/retained/);
		expect(() =>
			graph.deleteDerivedNode(materialDecisionGraphNodeKey("mat-1")),
		).toThrow(/retained|dependents/);
		expect(() => graph.deleteDerivedNode("scene-object/missing")).toThrow(
			/unknown/,
		);
		expect(() =>
			graph.deleteDerivedNode(preparedAssetGraphNodeKey("gfx-obj/02000001")),
		).toThrow(/prepared asset/);
		expect(() =>
			graph.deleteUnreferencedPreparedAssetNode("gfx-obj/02000001"),
		).toThrow(/retained|dependents/);
	});

	it("allows explicit prepared-asset graph node cleanup after derived references are gone", () => {
		const graph = createFixtureGraph();
		for (const nodeKey of [
			staticBatchGraphNodeKey("batch-1"),
			atlasGenerationGraphNodeKey("atlas-1"),
			sceneObjectGraphNodeKey("tree-1"),
			materialDecisionGraphNodeKey("mat-1"),
		]) {
			graph.deleteDerivedNode(nodeKey);
		}

		graph.deleteUnreferencedPreparedAssetNode("gfx-obj/02000001");

		expect(graph.hasNode(preparedAssetGraphNodeKey("gfx-obj/02000001"))).toBe(
			false,
		);
	});
});

function createFixtureGraph(): RendererResourceGraph {
	const graph = new RendererResourceGraph();
	graph.transaction((draft) => {
		for (const node of [
			{
				key: preparedAssetGraphNodeKey("setup-appearance/02000001"),
				kind: "prepared-asset" as const,
			},
			{
				key: preparedAssetGraphNodeKey("gfx-obj/02000001"),
				kind: "prepared-asset" as const,
			},
			{
				key: preparedAssetGraphNodeKey("material/08000001"),
				kind: "prepared-asset" as const,
			},
			{
				key: preparedAssetGraphNodeKey(
					"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
				),
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
			preparedAssetGraphNodeKey(
				"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			),
		]);
		draft.replaceDependencies(sceneObjectGraphNodeKey("tree-1"), [
			preparedAssetGraphNodeKey("gfx-obj/02000001"),
			materialDecisionGraphNodeKey("mat-1"),
			preparedAssetGraphNodeKey("setup-appearance/02000001"),
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
