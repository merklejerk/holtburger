import { describe, expect, it } from "vitest";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../resolution/presentation";
import { resolveObjectTriangleMaterial } from "./object-material-binding";

const MATERIAL: ResolvedMaterial = {
	id: "material:side-expansion-test",
	kind: "solid-color",
	color: [1, 1, 1, 1],
	rawSurfaceFlags: 0,
	translucency: 0,
	luminosity: 0,
	diffuseScale: 1,
};

describe("resolveObjectTriangleMaterial", () => {
	it("keeps both CullMode.None expansions one-sided and in one binding", () => {
		const geometry = expandedGeometry([0, 1], [1, 1]);

		const positive = resolveObjectTriangleMaterial({
			detailRole: "environment",
			geometry,
			materials: [MATERIAL],
			sourceLabel: "expanded CullMode.None fixture",
			triangle: 0,
		});
		const reversed = resolveObjectTriangleMaterial({
			detailRole: "environment",
			geometry,
			materials: [MATERIAL],
			sourceLabel: "expanded CullMode.None fixture",
			triangle: 1,
		});

		// Both expansions must stay one-sided so the pair does not submit the same coplanar
		// surface twice, and must share a binding so they batch as one run instead of splitting
		// every two-sided polygon into its own pair of draw ranges.
		expect(positive.binding.polygon).toEqual({
			cullFace: "back",
			stippled: false,
		});
		expect(reversed.binding.polygon).toEqual(positive.binding.polygon);
		expect(reversed.bindingId).toBe(positive.bindingId);
	});

	it("preserves counter-clockwise authored rejection as front-face culling", () => {
		const resolved = resolveObjectTriangleMaterial({
			detailRole: "environment",
			geometry: expandedGeometry([0], [3]),
			materials: [MATERIAL],
			sourceLabel: "counter-clockwise fixture",
			triangle: 0,
		});

		expect(resolved.binding.polygon).toMatchObject({ cullFace: "front" });
	});

	it("rejects an authored culling mode it cannot reduce to draw state", () => {
		expect(() =>
			resolveObjectTriangleMaterial({
				detailRole: "environment",
				geometry: expandedGeometry([0], [9]),
				materials: [MATERIAL],
				sourceLabel: "unsupported culling fixture",
				triangle: 0,
			}),
		).toThrow("Unsupported polygon culling mode 9.");
	});
});

function expandedGeometry(
	sideKinds: readonly number[],
	sideTypes: readonly number[],
): ResolvedGeometry {
	const triangleCount = sideKinds.length;
	if (sideTypes.length !== triangleCount) {
		throw new Error("Side kind/type fixtures must have equal lengths.");
	}
	return {
		id: "geometry:side-expansion-test",
		positions: new Float32Array(triangleCount * 9),
		normals: new Float32Array(triangleCount * 9),
		textureCoordinates: new Float32Array(triangleCount * 6),
		indices: Uint32Array.from(
			{ length: triangleCount * 3 },
			(_, index) => index,
		),
		materialSlotIndices: new Uint16Array(triangleCount),
		materialWrapModes: new Uint8Array(triangleCount),
		materialSideKinds: Uint8Array.from(sideKinds),
		materialSideTypes: Uint8Array.from(sideTypes),
		materialStippling: new Uint8Array(triangleCount),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		bounds: null,
	};
}
