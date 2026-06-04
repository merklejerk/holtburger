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

	it("keeps prepared assets retained until every owner releases its lease", () => {
		const graph = createFixtureGraph();
		const sceneLease = graph.leaseNode(
			sceneObjectGraphNodeKey("tree-1"),
			"visible scene",
		);
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "debug picker");

		graph.releaseLease(sceneLease);

		expect(graph.retainedPreparedAssetIds()).toEqual([
			"gfx-obj/02000001",
			"material/08000001",
			"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
			"setup-appearance/02000001",
		]);
	});

	it("releases prepared assets when their owner lease is released", () => {
		const graph = createFixtureGraph();
		const lease = graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");

		graph.releaseLease(lease);

		expect(graph.retainedPreparedAssetIds()).toEqual([]);
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

	it("rejects cycles from batch updates as catastrophic graph errors", () => {
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

		expect(graph.hasNode(sceneObjectGraphNodeKey("first"))).toBe(true);
	});

	it("returns deterministic retained prepared asset ids", () => {
		const graph = new RendererResourceGraph();
		graph.transaction((draft) => {
			for (const node of [
				{
					key: preparedAssetGraphNodeKey("z"),
					kind: "prepared-asset" as const,
				},
				{
					key: preparedAssetGraphNodeKey("a"),
					kind: "prepared-asset" as const,
				},
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
	});

	it("uses canonical prepared-asset nodes rather than duplicate semantic texture nodes", () => {
		const graph = createFixtureGraph();
		graph.leaseNode(sceneObjectGraphNodeKey("tree-1"), "scene");

		expect(graph.retainedPreparedAssetIds()).toContain(
			"prepared-texture/raw/05000001?format=rgba8&mips=none&cs=linear",
		);
		expect(graph.hasNode("render-surface/05000001")).toBe(false);
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
