import { describe, expect, it } from "vitest";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { DynamicEntityCategory } from "../dynamic-entity-category";
import type { ObjectGeometryKey } from "../geometry/types";
import type { Frustum } from "../math/frustum";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type {
	PartVisualTemplateKey,
	VisibleRigidPartContribution,
} from "../systems/components";
import type { ObjectInstanceData } from "../systems/static-resources";
import { TextureWrapMode } from "../textures/types";
import type {
	RenderContribution,
	ResolvedGeometryDrawUnit,
} from "./render-world";
import {
	collectOutdoorPssmCasters,
	createOutdoorPssmCasterBatch,
	formOutdoorPssmCasterRuns,
	type OutdoorPssmCasterPart,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";

const ANCHOR = "0x0001ffff";
const FRUSTUM: Frustum = { cameraPosition: Vec3.zero(), planes: [] };

describe("outdoor PSSM caster selection", () => {
	it("consumes an outdoor dynamic query and retains only eligible visible outdoor parts", () => {
		const player = "scene-node:1" as SceneNodeId;
		const npc = "scene-node:2" as SceneNodeId;
		const other = "scene-node:3" as SceneNodeId;
		const indoorOnly = "scene-node:4" as SceneNodeId;
		const emptyMob = "scene-node:5" as SceneNodeId;
		const queryEntries = [player, npc, other, indoorOnly, emptyMob];
		const descriptors = new Map<SceneNodeId, RenderContribution>([
			[player, dynamicDescriptor("player")],
			[npc, dynamicDescriptor("npc")],
			[other, dynamicDescriptor("other")],
			[indoorOnly, dynamicDescriptor("mob")],
			[emptyMob, dynamicDescriptor("mob")],
		]);
		const contributions = new Map<
			SceneNodeId,
			readonly VisibleRigidPartContribution[]
		>([
			[player, [part(0, "outdoor")]],
			[npc, [part(1, "outdoor")]],
			[other, [part(2, "outdoor")]],
			[indoorOnly, [part(3, "env-cell")]],
			[emptyMob, []],
		]);
		const observed: string[] = [];
		const world = createWorld(
			queryEntries,
			descriptors,
			contributions,
			observed,
		);
		const selected = new Set<SceneNodeId>();
		const batch = createOutdoorPssmCasterBatch();

		collectOutdoorPssmCasters(world, FRUSTUM, ANCHOR, selected, batch);

		expect(observed).toEqual([
			"query:outdoor:true:false",
			"descriptor:scene-node:1",
			"expand:scene-node:1",
			"resolve:scene-node:1",
			"descriptor:scene-node:2",
			"expand:scene-node:2",
			"resolve:scene-node:2",
			"descriptor:scene-node:3",
			"descriptor:scene-node:4",
			"expand:scene-node:4",
			"resolve:scene-node:4",
			"descriptor:scene-node:5",
			"expand:scene-node:5",
			"resolve:scene-node:5",
		]);
		expect(batch.parts).toHaveLength(2);
		expect(batch.instances).toEqual([
			contributions.get(player)?.[0]?.instance,
			contributions.get(npc)?.[0]?.instance,
		]);
		expect(selected).toEqual(new Set([player, npc]));
	});

	it("owns compact results before the next reused scene query", () => {
		const first = "scene-node:10" as SceneNodeId;
		const second = "scene-node:11" as SceneNodeId;
		const reusedEntries = [first];
		const descriptors = new Map<SceneNodeId, RenderContribution>([
			[first, dynamicDescriptor("mob")],
			[second, dynamicDescriptor("mob")],
		]);
		const contributions = new Map([
			[first, [part(0, "outdoor")]],
			[second, [part(1, "outdoor")]],
		]);
		const world = createWorld(reusedEntries, descriptors, contributions, []);
		const selected = new Set<SceneNodeId>();
		const batch = createOutdoorPssmCasterBatch();

		collectOutdoorPssmCasters(world, FRUSTUM, ANCHOR, selected, batch);
		const firstInstance = batch.instances[0];
		reusedEntries[0] = second;

		expect(batch.instances).toEqual([firstInstance]);
		expect(selected).toEqual(new Set([first]));
	});
});

describe("outdoor PSSM caster run formation", () => {
	it("groups separated compatible parts and splits consumed raster state", () => {
		const batch = createOutdoorPssmCasterBatch();
		const instances = batch.instances;
		const runs = batch.runs;
		batch.parts.push(
			casterPart(0, "geometry-resource:1", "back"),
			casterPart(1, "geometry-resource:2", "back"),
			casterPart(2, "geometry-resource:1", "back"),
			casterPart(3, "geometry-resource:1", "front"),
		);

		formOutdoorPssmCasterRuns(batch);

		expect(batch.instances).toBe(instances);
		expect(batch.runs).toBe(runs);
		expect(batch.instances).toEqual([
			batch.parts[0]?.instance,
			batch.parts[2]?.instance,
			batch.parts[1]?.instance,
			batch.parts[3]?.instance,
		]);
		expect(batch.runs).toMatchObject([
			{ firstInstance: 0, instanceCount: 2, geometry: "geometry-resource:1" },
			{ firstInstance: 2, instanceCount: 1, geometry: "geometry-resource:2" },
			{
				firstInstance: 3,
				instanceCount: 1,
				geometry: "geometry-resource:1",
				cullFace: "front",
			},
		]);
	});
});

function createWorld(
	queryEntries: SceneNodeId[],
	descriptors: ReadonlyMap<SceneNodeId, RenderContribution>,
	contributions: ReadonlyMap<
		SceneNodeId,
		readonly VisibleRigidPartContribution[]
	>,
	observed: string[],
): OutdoorPssmCasterWorld {
	let resolvingNode: SceneNodeId | null = null;
	return {
		expandDynamicContributions(nodeId) {
			observed.push(`expand:${nodeId}`);
			resolvingNode = nodeId;
			return contributions.get(nodeId) ?? [];
		},
		getRenderContributionDescriptor(nodeId) {
			observed.push(`descriptor:${nodeId}`);
			return descriptors.get(nodeId) ?? null;
		},
		queryScopesScene(frustum, anchor, scopes, filter) {
			expect(frustum).toBe(FRUSTUM);
			expect(anchor).toBe(ANCHOR);
			observed.push(
				`query:${scopes[0]?.kind}:${filter("dynamic")}:${filter("buildings")}`,
			);
			return { entries: queryEntries };
		},
		resolveDynamicContributions(values) {
			if (resolvingNode === null)
				throw new Error("Resolve called before expansion.");
			observed.push(`resolve:${resolvingNode}`);
			return values.map((drawUnit, index) => ({
				drawUnit,
				geometry: `geometry-resource:${index + Number(resolvingNode?.slice(11))}`,
			})) as readonly ResolvedGeometryDrawUnit<VisibleRigidPartContribution>[];
		},
	};
}

function dynamicDescriptor(
	category: DynamicEntityCategory,
): RenderContribution {
	return {
		category,
		footprint: {
			kind: "eligible",
			localBounds: AABB3.zero(),
			objectClass: "authored-dynamic",
			placement: {
				envCellId: null,
				landblockId: ANCHOR,
				localToLandblock: Mat4.identity(),
				scope: { kind: "outdoor" },
			},
		},
		kind: "dynamic",
	};
}

function part(
	partIndex: number,
	scope: "outdoor" | "env-cell",
): VisibleRigidPartContribution {
	return {
		drawUnit: {
			batchKey: `part:${partIndex}`,
			geometry: `object-geometry:${partIndex}` as ObjectGeometryKey,
			indexCount: 3,
			indexStart: 0,
			material: material("back"),
			ordering: "opaque",
			partIndex,
			templatePartKey:
				`part-visual-template:${partIndex}` as PartVisualTemplateKey,
		},
		instance: instance(partIndex),
		landblockId: ANCHOR,
		ordering: "opaque",
		renderScopes:
			scope === "outdoor"
				? [{ kind: "outdoor" }]
				: [{ envCellId: "0x0100", kind: "env-cell", landblockId: ANCHOR }],
		transparentSort: null,
	};
}

function casterPart(
	translation: number,
	geometry: OutdoorPssmCasterPart["geometry"],
	cullFace: OutdoorPssmCasterPart["cullFace"],
): OutdoorPssmCasterPart {
	return {
		cullFace,
		geometry,
		indexCount: 3,
		indexStart: 0,
		instance: instance(translation),
		landblockId: ANCHOR,
	};
}

function instance(translation: number): ObjectInstanceData {
	const sourceToLandblock = Mat4.identity();
	sourceToLandblock.m41 = translation;
	return {
		color: { a: 1, b: 1, g: 1, r: 1 },
		sourceToLandblock,
	};
}

function material(cullFace: "back" | "front"): ObjectMaterialBinding {
	return {
		detailRole: null,
		palettedClipMap: false,
		polygon: { cullFace, stippled: false },
		sampler: { wrap: TextureWrapMode.Clamp },
		source: {
			color: [1, 1, 1, 1],
			diffuseScale: 1,
			id: "material:shadow-caster-test",
			kind: "solid-color",
			luminosity: 0,
			rawSurfaceFlags: 0,
			translucency: 0,
		},
		textures: { base: null, palette: null },
	};
}
