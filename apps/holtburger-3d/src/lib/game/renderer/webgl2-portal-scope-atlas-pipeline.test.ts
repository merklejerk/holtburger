import { describe, expect, it, vi } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { Mat4, Quat, Vec3 } from "../math/types";
import type {
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import { createCameraNearClipVolume } from "./portal-near-plane";
import type { PortalPropagationStreamView } from "./portal-crossing-triangle-stream";
import { WebGL2PortalScopeAtlasPipeline } from "./webgl2-portal-scope-atlas-pipeline";

const device = vi.hoisted(() => ({ resize: vi.fn(), execute: vi.fn() }));

// Keep real visibility, packing, routing, and CPU streams; replace only GPU resource owners.
vi.mock("./webgl2-portal-scope-atlas-targets", () => ({
	WebGL2PortalScopeAtlasTargets: class {
		resize(extents: { atlas: { width: number; height: number } }) {
			device.resize(extents);
			return { extents, scene: { framebuffer: null } };
		}
	},
}));
vi.mock("./webgl2-portal-scope-atlas-executor", () => ({
	WebGL2PortalScopeAtlasExecutor: class {
		execute(input: { stream: PortalPropagationStreamView }) {
			device.execute(input.stream.propagationMetadataBytes.slice());
		}
	},
}));

describe("deferred portal view ownership", () => {
	it("preserves per-view plans and streams, allocating targets only during execution", () => {
		device.resize.mockClear();
		device.execute.mockClear();
		const calls = vi.fn();
		const gl = {
			bindFramebuffer: calls,
			viewport: calls,
			disable: calls,
			colorMask: calls,
			depthMask: calls,
			clearDepth: calls,
			clearColor: calls,
			clear: calls,
			uniform4f: calls,
		} as unknown as WebGL2RenderingContext;
		const pipeline = new WebGL2PortalScopeAtlasPipeline(gl);
		const outdoor = { kind: "outdoor" } as const;
		const indoor = {
			kind: "env-cell",
			landblockId: "0x0001ffff",
			envCellId: "0x00010100",
		} as const;
		const topology: SceneTopologyView = {
			revision: 1,
			crossings: [],
			outgoing: () => [],
			scopes: [outdoor, indoor].map((scope) => ({
				scope,
				visibilityIslandId:
					scope.kind === "outdoor"
						? null
						: ("env-cell-island:test" as SceneTopologyScope["visibilityIslandId"]),
				potentiallyVisibleEnvCellIds: new Set<string>(),
			})),
		};
		const anchor = getLandblockCoordinates("0x0001ffff");
		function prepare(rootScope: SceneScope, width: number) {
			const clip = Mat4.identity();
			return pipeline.prepare(
				topology,
				{
					anchorCoordinates: anchor,
					clipFromAnchor: clip,
					rootScope,
					nearClipVolume: createCameraNearClipVolume(
						{ fov: 90, near: 0.5 },
						{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
						1,
					),
					portalFootprint: {
						drawingBuffer: { width, height: 100 },
						minimumPixelArea: 0,
					},
				},
				anchor,
				clip,
				width,
				100,
			);
		}
		pipeline.beginFrame();
		const first = prepare(outdoor, 200);
		const firstTileWidth = first.atlas.tileWidth(0);
		const second = prepare(indoor, 400);
		expect(first).not.toBe(second);
		expect(first.scopeAt(0)).toEqual(outdoor);
		expect(second.scopeAt(0)).toEqual(indoor);
		expect(first.atlas.tileWidth(0)).toBe(firstTileWidth);
		expect(second.atlas.tileWidth(0)).not.toBe(firstTileWidth);
		expect(calls).not.toHaveBeenCalled();
		expect(device.resize).not.toHaveBeenCalled();
		pipeline.beginOpaqueScene(first, [0, 0, 0, 1]);
		pipeline.routeTerrainPass(3, {});
		pipeline.execute(null);
		pipeline.beginOpaqueScene(second, [0, 0, 0, 1]);
		pipeline.routeTerrainPass(0, {});
		pipeline.execute(null);
		expect(first.opaqueRouting.trace.terrainSubmissionCount).toBe(3);
		expect(second.opaqueRouting.trace.terrainSubmissionCount).toBe(0);
		expect(device.resize).toHaveBeenCalledTimes(2);
		expect(device.execute.mock.calls[0]).not.toEqual(
			device.execute.mock.calls[1],
		);
		pipeline.beginFrame();
		expect(() => first.atlas).toThrow("no prepared frame");
		expect(() => pipeline.beginOpaqueScene(second, [0, 0, 0, 1])).toThrow(
			"not prepared",
		);
		expect(prepare(outdoor, 200)).toBe(first);
	});
});
