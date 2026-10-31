import { describe, expect, it, vi } from "vitest";
import { Mat4, AABB3, Vec3 } from "../math/types";
import { skyViewMatrix, WebGL2SkyPass } from "./webgl2-sky-pass";
import { HostCommandError } from "../../host/host-command-result";
import { resolveObjectBehavior } from "../resolution/object-resident-classifier";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	createSkyFragmentShader,
	createSkyVertexShader,
} from "./webgl2-sky-program";

describe("skyViewMatrix", () => {
	it("joins sibling texture work before releasing allocations from an unsuccessful sky load", async () => {
		let finish: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let prepares = 0;
		const sourceFailure = new HostCommandError({
			code: "application_error",
			message: "Invalid sky texture",
			resource: {
				kind: "invalid",
				namespace: "eor/portal",
				file_id: 0x06000001,
			},
		});
		const resources = {
			createGeometry: vi.fn(() => "geometry-resource:1" as const),
			createTexture2D: vi.fn(() => "texture-2d-resource:1" as const),
			releaseResource: vi.fn(),
			getGeometry() {
				throw new Error("No drawing during preparation");
			},
			getTexture2D() {
				throw new Error("No drawing during preparation");
			},
		} satisfies Parameters<typeof WebGL2SkyPass.prepare>[0];
		const preparer: TexturePreparer = {
			destroy: async () => {},
			prepare: async (fact) => {
				if (fact.kind !== "asset")
					throw new Error("Sky fixture requires standalone textures");
				prepares++;
				if (prepares === 1) throw sourceFailure;
				await held;
				return {
					key: fact.key,
					sourceAssetId: fact.sourceAssetId,
					purpose: fact.purpose,
					width: 1,
					height: 1,
					pixels: new Uint8Array(4),
				};
			},
		};
		const loading = WebGL2SkyPass.prepare(resources, preparer, skyFixture());
		await Promise.resolve();
		expect(resources.releaseResource).not.toHaveBeenCalled();
		if (finish === undefined) throw new Error("Sky sibling gate missing");
		finish();
		await expect(loading).rejects.toThrow("Sky texture preparation failed");
		expect(prepares).toBe(2);
		expect(resources.releaseResource.mock.calls).toEqual([
			["geometry-resource:1"],
			["texture-2d-resource:1"],
		]);
	});
	/** Celestial objects sit at the viewer's origin, so the sky rotates but never translates. */
	it("removes the view translation while preserving orientation", () => {
		const view = Mat4.identity();
		view.m11 = 0;
		view.m13 = -1;
		view.m41 = 12;
		view.m42 = -34;
		view.m43 = 56;
		const result = skyViewMatrix(view, new Float32Array(16));
		expect([result[12], result[13], result[14]]).toEqual([0, 0, 0]);
		expect(result[0]).toBe(0);
		expect(result[2]).toBe(-1);
	});
});

/** Two independently prepared surfaces share one geometry allocation. */
function skyFixture(): SkySourcePresentations {
	return {
		textureDependencies: [],
		presentations: new Map([
			[
				"0x01000001",
				{
					setupId: null,
					partParents: [],
					localBounds: null,
					behavior: resolveObjectBehavior({
						animationId: null,
						motionTableId: null,
						physicsScriptId: null,
						physicsScriptTableId: null,
						soundTableId: null,
					}),
					presentation: {
						id: "presentation:sky-fixture",
						appearanceKey: "sky-fixture",
						sourceAssetId: "0x01000001",
						lights: [],
						holdingLocations: new Map(),
						selectionBounds: null,
						sortingBounds: null,
						placementPoses: new Map([
							[0, { placementId: 0, partTransforms: [Mat4.identity()] }],
						]),
						parts: [
							{
								partIndex: 0,
								retailVisibility: "normally-visible",
								defaultScale: new Vec3(1, 1, 1),
								geometry: {
									id: "geometry:sky-fixture",
									bounds: AABB3.zero(),
									positions: new Float32Array(12),
									normals: new Float32Array(12),
									textureCoordinates: new Float32Array(8),
									indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
									materialSlotIndices: new Uint16Array([0, 1]),
									materialWrapModes: new Uint8Array(2),
									materialSideKinds: new Uint8Array(2),
									materialSideTypes: new Uint8Array(2),
									materialStippling: new Uint8Array(2),
									sourceDiagnostics: { rejectedDegenerateTriangles: [] },
								},
								materials: [1, 2].map((id) => ({
									kind: "texture" as const,
									id: `material:sky-${id}` as const,
									colorTextureId: `0x0500000${id}`,
									renderSurfaceId: `0x0600000${id}`,
									textureEncoding: "direct-color" as const,
									paletteTextureId: null,
									paletteComposite: null,
									diffuseScale: 1,
									luminosity: 0,
									translucency: 0,
									rawSurfaceFlags: 0,
								})),
							},
						],
					},
				},
			],
		]),
	};
}

describe("portal sky shader variants", () => {
	it("routes celestial and weather geometry through the packed outdoor tile", () => {
		const shader = createSkyVertexShader(true);

		expect(shader).toContain("uniform vec4 uClipTransform");
		expect(shader).toContain(
			"clipPosition.xy = clipPosition.xy * uClipTransform.xy",
		);
		expect(shader).toContain("clipPosition.ww * uClipTransform.zw");
		expect(shader).toContain("gl_Position = clipPosition");
		expect(shader).not.toContain("uClipTransform * uProjection");
	});

	it("keeps the sky material shader independent from portal visibility state", () => {
		const shader = createSkyFragmentShader();

		expect(shader).not.toContain("uPortalEnvelopeDepth");
		expect(shader).toContain("vec4 color = uMaterialKind");
	});
});
