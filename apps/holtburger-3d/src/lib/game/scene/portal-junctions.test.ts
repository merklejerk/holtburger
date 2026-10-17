import { describe, expect, it, vi } from "vitest";
import BigNumber from "bignumber.js";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ScenePortalCrossingInput, SceneTopologyScope } from ".";
import { SceneGraph } from ".";
import {
	JUNCTION_OVERLAP_AREA_MINIMUM,
	JUNCTION_PLANE_OFFSET_EPSILON,
	resolvePortalJunctions,
} from "./portal-junctions";
import { scopeKey } from "./scope";
import { EnvCellSystem } from "../systems/env-cell-system";
import { createPortalGeometryKey } from "../geometry/types";
import type { GeometryManager } from "../geometry/geometry-manager";
import type { EnvCellLayerArtifact } from "../commit/artifacts";
import type { SceneInterestRevision } from "../runtime/scene-availability";

type Aperture = ScenePortalCrossingInput["sourceAperture"];
const WEST = "0xd599ffff";
const EAST = "0xd699ffff";
const SIZE = OUTDOOR_LANDBLOCK_WORLD_SIZE;

/** Ordered rectangular source boundary in the local owner frame, normal along +X. */
function aperture(
	id: string,
	owner: string,
	x: number,
	bottom = 0,
	top = 4,
	south = -2,
	north = 2,
): Aperture {
	return {
		id: `portal-aperture:${id}`,
		landblockId: owner,
		vertices: new Float32Array([
			x,
			bottom,
			south,
			x,
			top,
			south,
			x,
			top,
			north,
			x,
			bottom,
			north,
		]),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		plane: { normal: new Vec3(1, 0, 0), d: -x },
		landblockBounds: new AABB3(
			new Vec3(x, bottom, south),
			new Vec3(x, top, north),
		),
	};
}

/** One actual doorway contributes both authored directions through the outdoor domain. */
function doorway(id: string, aperture: Aperture): ScenePortalCrossingInput[] {
	const cell = {
		kind: "env-cell",
		envCellId: id,
		landblockId: aperture.landblockId,
	} as const;
	const outdoor = { kind: "outdoor" } as const;
	return (
		[
			{
				id: `portal-crossing:${id}/exit`,
				source: cell,
				target: outdoor,
				reciprocalCrossingId: `portal-crossing:${id}/entry`,
				acceptedSide: "positive",
			},
			{
				id: `portal-crossing:${id}/entry`,
				source: outdoor,
				target: cell,
				reciprocalCrossingId: `portal-crossing:${id}/exit`,
				acceptedSide: "negative",
			},
		] as const
	).map((crossing) => ({
		...crossing,
		sourceAperture: aperture,
		visibilityAperture: aperture,
		exactMatch: true,
		maskDepthPolicy: "allow-equal-depth",
		spatialRelationship: {
			kind: "exterior-transition",
			exteriorLandblockId: aperture.landblockId,
		},
	}));
}
function scopes(
	crossings: readonly ScenePortalCrossingInput[],
): SceneTopologyScope[] {
	const unique = new Map<string, SceneTopologyScope>();
	for (const crossing of crossings)
		for (const scope of [crossing.source, crossing.target]) {
			unique.set(scopeKey(scope), {
				scope,
				visibilityIslandId:
					scope.kind === "outdoor"
						? null
						: `env-cell-island:${scope.envCellId}`,
				potentiallyVisibleEnvCellIds: new Set(),
			});
		}
	return [...unique.values()];
}
function resolve(crossings: readonly ScenePortalCrossingInput[]) {
	return resolvePortalJunctions(crossings, scopes(crossings));
}
function expectJoined(crossings: readonly ScenePortalCrossingInput[]): void {
	const groups = resolve(crossings).map((c) => c.junctionGroupId);
	expect(groups[0]).not.toBeNull();
	expect(new Set(groups).size).toBe(1);
}
function expectSeparate(crossings: readonly ScenePortalCrossingInput[]): void {
	expect(resolve(crossings).every((c) => c.junctionGroupId === null)).toBe(
		true,
	);
}

/** Preserve the authored f32 geometry of a numerical counterexample without runtime assets. */
function authoredAperture(
	id: string,
	vertices: number[],
	normal: Vec3,
	d: number,
): Aperture {
	const coordinates = (axis: number) =>
		vertices.filter((_, index) => index % 3 === axis);
	const minimum = (axis: number) => Math.min(...coordinates(axis));
	const maximum = (axis: number) => Math.max(...coordinates(axis));
	return {
		id: `portal-aperture:${id}`,
		landblockId: "0x0d4affff",
		vertices: new Float32Array(vertices),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		plane: { normal, d },
		landblockBounds: new AABB3(
			new Vec3(minimum(0), minimum(1), minimum(2)),
			new Vec3(maximum(0), maximum(1), maximum(2)),
		),
	};
}

/** 0D4A0122/0116: valid convex rings with a positive projected overlap near 7.25e-9 m².
 * polygon-clipping 0.15.7 fails to assemble the output ring for this pair.
 */
function nearlyTouchingAuthoredApertures(): readonly [Aperture, Aperture] {
	return [
		authoredAperture(
			"tilted",
			[
				91.76444244384766, 40.20000076293945, -72, 74.4000015258789,
				30.200000762939453, -72, 76.23491668701172, 29, -71.9999008178711,
				91.76444244384766, 29, -72,
			],
			new Vec3(4.7641242417739704e-7, 8.1589032561169e-6, 1),
			71.99967956542969,
		),
		authoredAperture(
			"rectangular",
			[
				91.76445007324219, 18.200000762939453, -72, 76.23556518554688,
				18.200000762939453, -72.00001525878906, 76.23556518554688, 29,
				-72.00001525878906, 91.76445007324219, 29, -72,
			],
			new Vec3(5.960464477539063e-7, 0, -1.0000005960464478),
			-72.00008392333984,
		),
	];
}

/** 0D4A0122/0119: exposes polyclip-ts's insufficient 20-decimal-place division default. */
function divisionSensitiveAuthoredApertures(): readonly [Aperture, Aperture] {
	return [
		authoredAperture(
			"sloped",
			[
				76.23492431640625, 29, -96.0000991821289, 74.4000015258789,
				30.200000762939453, -96, 91.76444244384766, 40.20000076293945, -96,
				91.76444244384766, 29, -96,
			],
			new Vec3(6.512580057460582e-7, 8.1589032561169e-6, -1),
			-96.00033569335938,
		),
		authoredAperture(
			"trapezoid",
			[
				76.23555755615234, 19, -96, 91.76444244384766, 18.200000762939453, -96,
				91.76444244384766, 29, -96, 76.23555755615234, 29, -96,
			],
			new Vec3(-8.742279788975793e-8, 0, 1),
			96.00000762939453,
		),
	];
}

describe("resident portal junctions", () => {
	it("resolves the division-sensitive authored pair without changing caller precision", () => {
		const previous = BigNumber.config();
		try {
			BigNumber.config({
				DECIMAL_PLACES: 3,
				ROUNDING_MODE: BigNumber.ROUND_DOWN,
			});
			const callerPrecision = BigNumber.config();
			const [a, b] = divisionSensitiveAuthoredApertures();
			expectSeparate([...doorway("a", a), ...doorway("b", b)]);
			expect(BigNumber.config()).toEqual(callerPrecision);
		} finally {
			BigNumber.config(previous);
		}
	});
	it("resolves the authored thin overlap without inventing a junction", () => {
		const [a, b] = nearlyTouchingAuthoredApertures();
		expectSeparate([...doorway("a", a), ...doorway("b", b)]);
		expectSeparate([...doorway("b", b), ...doorway("a", a)]);
	});
	it("retains the authored thin overlap when proving competing exits", () => {
		const [a, b] = nearlyTouchingAuthoredApertures();
		const bridge: Aperture = {
			...a,
			id: "portal-aperture:bridge",
			vertices: new Float32Array([
				70, 15, -72, 95, 15, -72, 95, 42, -72, 70, 42, -72,
			]),
			landblockBounds: new AABB3(new Vec3(70, 15, -72), new Vec3(95, 42, -72)),
		};
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expectSeparate([
				...doorway("a", a),
				...doorway("b", b),
				...doorway("bridge", bridge),
			]);
			expect(warning).toHaveBeenCalledOnce();
		} finally {
			warning.mockRestore();
		}
	});
	it("joins the two sides of a landblock boundary in a nearby comparison frame", () => {
		expectJoined([
			...doorway("west", aperture("west", WEST, SIZE)),
			...doorway("east", aperture("east", EAST, 0)),
		]);
	});
	it("leaves an ordinary reciprocal doorway and isolated crossings ungrouped", () => {
		expectSeparate(doorway("single", aperture("single", WEST, 0)));
	});
	it("admits partial overlap and opposed source normals", () => {
		const target = aperture("target", EAST, 0, 2, 6);
		expectJoined([
			...doorway("west", aperture("west", WEST, SIZE)),
			...doorway("east", {
				...target,
				plane: { normal: new Vec3(-1, 0, 0), d: 0 },
			}),
		]);
	});
	it("does not join edge contact, separate planes, or separate footprints", () => {
		const left = doorway("west", aperture("west", WEST, SIZE));
		for (const right of [
			aperture("edge", EAST, 0, 4, 8),
			aperture("plane", EAST, JUNCTION_PLANE_OFFSET_EPSILON * 2),
			aperture("elsewhere", EAST, 0, 0, 4, 3, 5),
		]) {
			expectSeparate([...left, ...doorway("east", right)]);
		}
	});
	it("keeps distinct ordinary footprints in distinct junctions", () => {
		const first = [
			...doorway("a", aperture("a", WEST, 0)),
			...doorway("b", aperture("b", WEST, 0)),
		];
		const second = [
			...doorway("c", aperture("c", WEST, 20)),
			...doorway("d", aperture("d", WEST, 20)),
		];
		const result = resolve([...first, ...second]);
		expect(result[0]!.junctionGroupId).not.toBeNull();
		expect(result[4]!.junctionGroupId).not.toBeNull();
		expect(result[0]!.junctionGroupId).not.toBe(result[4]!.junctionGroupId);
	});
	it("permits one tall opening opposite disjoint partition pieces", () => {
		expectJoined([
			...doorway("tall", aperture("tall", WEST, SIZE, 0, 3)),
			...doorway("lower", aperture("lower", EAST, 0, 0, 1)),
			...doorway("middle", aperture("middle", EAST, 0, 1, 2)),
			...doorway("upper", aperture("upper", EAST, 0, 2, 3)),
		]);
	});
	it("declines a whole component when three same-domain exits overlap", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expectSeparate([
				...doorway("tall", aperture("tall", WEST, SIZE, 0, 3)),
				...doorway("lower", aperture("lower", EAST, 0, 0, 2)),
				...doorway("upper", aperture("upper", EAST, 0, 1, 3)),
			]);
			expect(warning).toHaveBeenCalledOnce();
		} finally {
			warning.mockRestore();
		}
	});
	it("counts subthreshold overlap toward competing exits", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const sliver = JUNCTION_OVERLAP_AREA_MINIMUM / 8;
			expectSeparate([
				...doorway("tall", aperture("tall", WEST, 0, 0, 2)),
				...doorway("lower", aperture("lower", WEST, 0, 0, 1)),
				...doorway("upper", aperture("upper", WEST, 0, 1 - sliver, 2)),
			]);
			expect(warning).toHaveBeenCalledOnce();
		} finally {
			warning.mockRestore();
		}
	});
	it("does not let a subthreshold contact outside a component invalidate it", () => {
		const large = [
			...doorway("a", aperture("a", WEST, 0)),
			...doorway("b", aperture("b", WEST, 0)),
		];
		const tiny = doorway(
			"tiny",
			aperture("tiny", WEST, 0, 0, JUNCTION_OVERLAP_AREA_MINIMUM / 8),
		);
		const groups = resolve([...large, ...tiny]).map((c) => c.junctionGroupId);
		expect(groups[0]).not.toBeNull();
		expect(groups.slice(0, 4).every((g) => g === groups[0])).toBe(true);
		expect(groups.slice(4)).toEqual([null, null]);
	});
	it("rejects components chained through non-coincident planes", () => {
		const step = JUNCTION_PLANE_OFFSET_EPSILON * 0.75;
		const crossings = [
			...doorway("a", aperture("a", WEST, 0)),
			...doorway("b", aperture("b", WEST, step)),
			...doorway("c", aperture("c", WEST, step * 2)),
		];
		// Distinct source domains isolate the plane-coherence check from exit ambiguity.
		const directed = crossings
			.filter((c) => c.source.kind !== "outdoor")
			.map((c) => ({ ...c, reciprocalCrossingId: null }));
		expect(() => resolve(directed)).toThrow("chains non-coincident planes");
	});
	it("retains physical endpoint and aperture identity in derived crossings", () => {
		const input = [
			...doorway("west", aperture("west", WEST, SIZE)),
			...doorway("east", aperture("east", EAST, 0)),
		];
		const result = resolve(input);
		for (let i = 0; i < input.length; i++) {
			expect(result[i]!.sourceAperture).toBe(input[i]!.sourceAperture);
			expect(result[i]!.source).toBe(input[i]!.source);
			expect(result[i]!.target).toBe(input[i]!.target);
		}
	});
});

describe("junction residency lifecycle", () => {
	it("rebuilds coherently for load, eviction, replacement, rollback, and reinsertion", () => {
		const scene = new SceneGraph();
		// These artifacts contain no GPU geometry; a real scene and real publication owner suffice.
		const geometry = {
			reserveKeys: () => {},
			dropOwner: () => {},
			upsertGeometry: () => {},
		} as unknown as GeometryManager<string>;
		const system = new EnvCellSystem<string, string>(
			scene,
			geometry,
			(owner, revision) => `${owner}/${revision}`,
		);
		const west = doorway("west", aperture("west", WEST, SIZE));
		const east = doorway("east", aperture("east", EAST, 0));
		const artifact = (
			crossings: readonly ScenePortalCrossingInput[],
		): EnvCellLayerArtifact => ({
			geometry: [
				...new Map(crossings.map((c) => [c.sourceAperture.id, c])).values(),
			].map((c) => ({
				key: createPortalGeometryKey(c.sourceAperture.id),
				geometry: {
					kind: "portal-aperture",
					positions: c.sourceAperture.vertices,
					indices: c.sourceAperture.indices,
				},
			})),
			cellShells: [],
			portalDrawUnits: new Map(
				crossings.map((c) => [
					c.sourceAperture.id,
					{
						apertureId: c.sourceAperture.id,
						geometry: createPortalGeometryKey(c.sourceAperture.id),
						indexStart: 0,
						indexCount: c.sourceAperture.indices.length,
						landblockId: c.sourceAperture.landblockId,
					},
				]),
			),
			crossings,
			scopes: scopes(crossings)
				.filter((s) => s.scope.kind === "env-cell")
				.map((s) => {
					if (s.scope.kind !== "env-cell" || s.visibilityIslandId === null)
						throw new Error("Expected indoor scope.");
					return {
						...s,
						scope: s.scope,
						visibilityIslandId: s.visibilityIslandId,
						containmentPlanes: new Float32Array(),
						landblockBounds: null,
						structureToLandblock: Mat4.identity(),
						seenOutside: true,
					};
				}),
		});
		const revision = (value: number) => value as SceneInterestRevision;
		system.replace("west", revision(1), artifact(west));
		const initial = scene.getPortalTopologyView();
		expect(initial.crossings.every((c) => c.junctionGroupId === null)).toBe(
			true,
		);
		expect(scene.getPortalTopologyView()).toBe(initial);
		system.replace("east", revision(1), artifact(east));
		const joined = scene.getPortalTopologyView();
		expect(joined.crossings.every((c) => c.junctionGroupId !== null)).toBe(
			true,
		);
		expect(
			joined
				.outgoing({ kind: "outdoor" })
				.every((c) => joined.crossings.includes(c)),
		).toBe(true);
		const rollback = system.replace(
			"east",
			revision(2),
			artifact(doorway("east", aperture("apart", EAST, 10))),
		);
		expect(
			scene
				.getPortalTopologyView()
				.crossings.every((c) => c.junctionGroupId === null),
		).toBe(true);
		expect(joined.crossings.every((c) => c.junctionGroupId !== null)).toBe(
			true,
		);
		rollback();
		expect(
			scene
				.getPortalTopologyView()
				.crossings.every((c) => c.junctionGroupId !== null),
		).toBe(true);
		system.evict("east", revision(2));
		expect(
			scene
				.getPortalTopologyView()
				.crossings.every((c) => c.junctionGroupId === null),
		).toBe(true);
		system.replace("east", revision(3), artifact(east));
		expect(
			scene
				.getPortalTopologyView()
				.crossings.every((c) => c.junctionGroupId !== null),
		).toBe(true);
		system.destroy();
		expect(scene.getPortalTopologyView().crossings).toEqual([]);
	});
});
