import { describe, expect, it } from "vitest";

import { SceneGraph, type SceneScope } from "../scene";
import { getLandblockCoordinates } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import { createCameraNearClipVolume } from "./portal-near-plane";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import { PortalScopeWindowCuller } from "./portal-scope-window-culler";
import { selectedDynamicRenderScopeKeys } from "./dynamic-render-scopes";

const OUTDOOR: SceneScope = { kind: "outdoor" };
const CELL_A: SceneScope = {
	envCellId: "0x00010100",
	kind: "env-cell",
	landblockId: "0x0001ffff",
};
const CELL_B: SceneScope = {
	envCellId: "0x00010101",
	kind: "env-cell",
	landblockId: "0x0001ffff",
};

describe("dynamic render scope selection", () => {
	it("keeps a visible entity's resident domain when another membership cell is unloaded", () => {
		const scene = new SceneGraph();
		const scopes = [OUTDOOR, CELL_A];
		const node = scene.createNode({
			envCellId: null,
			landblockId: CELL_A.landblockId,
			localBounds: AABB3.zero(),
			localTransform: Mat4.identity(),
			parentId: null,
			spatialMembership: { scopes },
		});
		const culler = new PortalScopeWindowCuller(
			PORTAL_RENDER_CAPACITY_POLICY.culler,
		);
		const input = {
			anchorCoordinates: getLandblockCoordinates(CELL_A.landblockId),
			clipFromAnchor: Mat4.identity(),
			nearClipVolume: createCameraNearClipVolume(
				{ fov: 90, near: 0.5 },
				{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
				1,
			),
			portalFootprint: {
				drawingBuffer: { height: 100, width: 100 },
				minimumPixelArea: 0,
			},
			rootScope: OUTDOOR,
		};
		const visibility = culler.cull(scene.getPortalTopologyView(), input);
		expect(
			scene.queryScopeSelectionFrustum(
				{ cameraPosition: Vec3.zero(), planes: [] },
				CELL_A.landblockId,
				{
					count: visibility.selectedScopeCount,
					scopeAt: (ordinal) => visibility.selectedScope(ordinal),
				},
				() => true,
			).entries,
		).toEqual([node]);
		expect(selectedDynamicRenderScopeKeys(scopes, visibility)).toEqual([
			"outdoor",
		]);
		expect(visibility.selectedScopeOrdinal(CELL_A.envCellId)).toBeNull();

		// Loading and then withdrawing the sibling must update selection without changing authority.
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array(),
			landblockBounds: AABB3.zero(),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: CELL_A,
			seenOutside: false,
			structureToLandblock: Mat4.identity(),
			visibilityIslandId: "env-cell-island:test",
		});
		const loaded = culler.cull(scene.getPortalTopologyView(), {
			...input,
			rootScope: CELL_A,
		});
		expect(selectedDynamicRenderScopeKeys(scopes, loaded)).toEqual([
			CELL_A.envCellId,
		]);
		scene.removeEnvCellScope(CELL_A);
		const unloaded = culler.cull(scene.getPortalTopologyView(), input);
		const membership = scene.getResolvedSpatialMembership(node);
		if (membership === undefined)
			throw new Error("Entity lost scene membership.");
		expect(selectedDynamicRenderScopeKeys(membership.scopes, unloaded)).toEqual(
			["outdoor"],
		);
	});

	it("rejects missing spatial membership", () => {
		expect(() => selectedDynamicRenderScopeKeys([], null)).toThrow(
			"has no spatial membership",
		);
	});

	it("draws a plural member once in flat mode", () => {
		expect(selectedDynamicRenderScopeKeys([OUTDOOR, CELL_A], null)).toEqual([
			"outdoor",
		]);
	});

	it("draws once in every selected distinct portal domain", () => {
		const ordinals = new Map<string, number>([
			["outdoor", 0],
			["0x00010100", 1],
		]);
		expect(
			selectedDynamicRenderScopeKeys([OUTDOOR, CELL_A, CELL_B], {
				selectedRenderDomainOrdinal: (key) => ordinals.get(key) ?? null,
			}),
		).toEqual(["outdoor", "0x00010100"]);
	});

	it("collapses sibling cells that share one visibility island", () => {
		expect(
			selectedDynamicRenderScopeKeys([CELL_A, CELL_B], {
				selectedRenderDomainOrdinal: () => 3,
			}),
		).toEqual(["0x00010100"]);
	});

	it("rejects a selected entity with no selected membership domain", () => {
		expect(() =>
			selectedDynamicRenderScopeKeys([CELL_A], {
				selectedRenderDomainOrdinal: () => null,
			}),
		).toThrow("no selected portal render domain");
	});
});
