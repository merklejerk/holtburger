import { describe, expect, it } from "vitest";
import { Mat4, Quat, Vec3 } from "../math/types";
import type { SceneScope, SceneTopologyView } from "../scene";
import { createCameraNearClipVolume } from "./portal-near-plane";
import { PortalScopeAtlasPlanInput } from "./portal-scope-atlas-plan-input";

function fixture() {
	return {
		topology: {
			revision: 1,
			crossings: [],
			scopes: [],
			outgoing: () => [],
		} satisfies SceneTopologyView,
		input: {
			anchorCoordinates: { x: 0, y: 1 },
			clipFromAnchor: Mat4.identity(),
			nearClipVolume: createCameraNearClipVolume(
				{ fov: 90, near: 0.5 },
				{ position: new Vec3(0, 0, 1), rotation: Quat.identity() },
				1,
			),
			portalFootprint: {
				drawingBuffer: { width: 200, height: 100 },
				minimumPixelArea: 0,
			},
			rootScope: { kind: "outdoor" } as SceneScope,
		},
		resource: {
			atlas: { width: 400, height: 200 },
			drawingBuffer: { width: 200, height: 100 },
			maximumArrivalStateCount: 16,
			maximumCrossingTriangleVertexCount: 96,
		},
	};
}

describe("retained portal plan inputs", () => {
	it("matches newly allocated equivalent values without retaining borrowed mutable fields", () => {
		const value = fixture();
		const saved = new PortalScopeAtlasPlanInput(
			value.topology,
			value.input,
			value.resource,
		);
		const equivalent = fixture();
		expect(
			saved.matches(value.topology, equivalent.input, equivalent.resource),
		).toBe(true);
		value.input.clipFromAnchor.m41 += 1;
		expect(saved.matches(value.topology, value.input, value.resource)).toBe(
			false,
		);
		expect(
			saved.matches(value.topology, equivalent.input, equivalent.resource),
		).toBe(true);
	});

	const mutations: readonly [
		string,
		(value: ReturnType<typeof fixture>) => void,
	][] = [
		[
			"topology identity",
			(value) => {
				value.topology = { ...value.topology };
			},
		],
		[
			"topology revision",
			(value) => {
				value.topology.revision += 1;
			},
		],
		[
			"anchor x",
			(value) => {
				value.input.anchorCoordinates.x += 1;
			},
		],
		[
			"anchor y",
			(value) => {
				value.input.anchorCoordinates.y += 1;
			},
		],
		[
			"root scope",
			(value) => {
				value.input.rootScope = {
					kind: "env-cell",
					landblockId: "0x0001ffff",
					envCellId: "0x00010100",
				};
			},
		],
		[
			"eye",
			(value) => {
				value.input.nearClipVolume.eye.x += 1;
			},
		],
		[
			"near plane distance",
			(value) => {
				const [first, second, third, fourth, fifth] =
					value.input.nearClipVolume.clippingPlanes;
				value.input.nearClipVolume = {
					...value.input.nearClipVolume,
					clippingPlanes: [
						{ ...first, d: first.d + 1 },
						second,
						third,
						fourth,
						fifth,
					],
				};
			},
		],
		[
			"footprint minimum",
			(value) => {
				value.input.portalFootprint.minimumPixelArea += 1;
			},
		],
		[
			"footprint width",
			(value) => {
				value.input.portalFootprint.drawingBuffer.width += 1;
			},
		],
		[
			"footprint height",
			(value) => {
				value.input.portalFootprint.drawingBuffer.height += 1;
			},
		],
		[
			"atlas width",
			(value) => {
				value.resource.atlas.width += 1;
			},
		],
		[
			"atlas height",
			(value) => {
				value.resource.atlas.height += 1;
			},
		],
		[
			"resource width",
			(value) => {
				value.resource.drawingBuffer.width += 1;
			},
		],
		[
			"resource height",
			(value) => {
				value.resource.drawingBuffer.height += 1;
			},
		],
		[
			"arrival limit",
			(value) => {
				value.resource.maximumArrivalStateCount += 1;
			},
		],
		[
			"triangle limit",
			(value) => {
				value.resource.maximumCrossingTriangleVertexCount += 1;
			},
		],
	];
	it.each(mutations)("invalidates changes to %s", (_name, mutate) => {
		const value = fixture();
		const saved = new PortalScopeAtlasPlanInput(
			value.topology,
			value.input,
			value.resource,
		);
		mutate(value);
		expect(saved.matches(value.topology, value.input, value.resource)).toBe(
			false,
		);
	});

	it.each([
		"m11",
		"m12",
		"m13",
		"m14",
		"m21",
		"m22",
		"m23",
		"m24",
		"m31",
		"m32",
		"m33",
		"m34",
		"m41",
		"m42",
		"m43",
		"m44",
	] as const)("invalidates in-place matrix changes to %s", (component) => {
		const value = fixture();
		const saved = new PortalScopeAtlasPlanInput(
			value.topology,
			value.input,
			value.resource,
		);
		value.input.clipFromAnchor[component] += 1;
		expect(saved.matches(value.topology, value.input, value.resource)).toBe(
			false,
		);
	});
	it.each([0, 1, 2, 3] as const)(
		"invalidates in-place near corner changes at %s",
		(corner) => {
			const value = fixture();
			const saved = new PortalScopeAtlasPlanInput(
				value.topology,
				value.input,
				value.resource,
			);
			value.input.nearClipVolume.corners[corner].z += 1;
			expect(saved.matches(value.topology, value.input, value.resource)).toBe(
				false,
			);
		},
	);
	it.each([0, 1, 2, 3, 4] as const)(
		"invalidates in-place near plane changes at %s",
		(plane) => {
			const value = fixture();
			const saved = new PortalScopeAtlasPlanInput(
				value.topology,
				value.input,
				value.resource,
			);
			value.input.nearClipVolume.clippingPlanes[plane].normal.y += 1;
			expect(saved.matches(value.topology, value.input, value.resource)).toBe(
				false,
			);
		},
	);
});
