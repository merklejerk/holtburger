import { describe, expect, it } from "vitest";
import { compileDynamicLayout } from "./dynamic-layout";
import type { ResolvedObjectPart } from "../resolution/presentation";
import { AABB3, Vec3 } from "../math/types";

describe("dynamic layout compilation", () => {
	it.each([
		["positions", new Float32Array(8), "incomplete positions"],
		["normals", new Float32Array(8), "incomplete normals"],
		["textureCoordinates", new Float32Array(5), "incomplete UVs"],
		["indices", new Uint32Array(2), "incomplete triangles"],
		["materialSlotIndices", new Uint16Array(1), "incomplete material slots"],
		["materialWrapModes", new Uint8Array(1), "incomplete wrap modes"],
		["materialWrapModes", new Uint8Array([0, 2]), "invalid wrap mode"],
	] as const)("rejects malformed %s data (%s)", (field, values, error) => {
		const original = part(0);
		expect(() =>
			compileDynamicLayout([
				{ ...original, geometry: { ...original.geometry, [field]: values } },
			]),
		).toThrow(error);
	});
	it("rejects negative authored part numbering", () => {
		expect(() => compileDynamicLayout([part(-1)])).toThrow(
			"invalid part index",
		);
	});
	it("splits shared vertices by slot/wrap while retaining source-local coordinates and index order", () => {
		const source = part(7);
		const layout = compileDynamicLayout([source]);
		expect(layout.parts).toEqual([
			{ partIndex: 7, indexStart: 0, indexCount: 6 },
		]);
		expect(layout.geometry.materialCount).toBe(2);
		expect([...layout.geometry.indices]).toEqual([0, 1, 2, 3, 4, 5]);
		expect([...layout.geometry.partSelectors]).toEqual([0, 0, 0, 0, 0, 0]);
		expect([...layout.geometry.materialSelectors]).toEqual([0, 0, 0, 1, 1, 1]);
		for (let index = 0; index < source.geometry.indices.length; index += 1) {
			const vertex = source.geometry.indices[index];
			const merged = layout.geometry.indices[index];
			if (vertex === undefined || merged === undefined)
				throw new Error("Fixture lost an index.");
			expect(
				layout.geometry.positions.slice(merged * 3, merged * 3 + 3),
			).toEqual(source.geometry.positions.slice(vertex * 3, vertex * 3 + 3));
		}
	});
	it("shares vertices within a selector and orders dense parts independently of input order", () => {
		const first = part(2);
		const repeated = {
			...first,
			geometry: {
				...first.geometry,
				materialWrapModes: new Uint8Array([0, 0]),
			},
		};
		const layout = compileDynamicLayout([part(9), repeated]);
		expect(layout.parts.map((p) => p.partIndex)).toEqual([2, 9]);
		expect([...layout.geometry.indices.slice(0, 6)]).toEqual([
			0, 1, 2, 0, 2, 1,
		]);
		expect(layout.geometry.partSelectors.length).toBe(9);
	});
	it("keys effective geometry independently of scales, materials, and retail visibility", () => {
		const original = part(2);
		const changed: ResolvedObjectPart = {
			...original,
			defaultScale: new Vec3(4, 5, 6),
			materials: [],
		};
		expect(compileDynamicLayout([original, part(9)]).key).toBe(
			compileDynamicLayout([part(9), changed]).key,
		);
		expect(compileDynamicLayout([original]).geometry.positions).toEqual(
			compileDynamicLayout([changed]).geometry.positions,
		);
		expect(compileDynamicLayout([original]).key).not.toBe(
			compileDynamicLayout([part(3)]).key,
		);
	});
	it("rejects duplicate parts and invalid vertex references", () => {
		expect(() => compileDynamicLayout([part(1), part(1)])).toThrow(
			"repeats part",
		);
		const original = part(1);
		expect(() =>
			compileDynamicLayout([
				{
					...original,
					geometry: {
						...original.geometry,
						indices: new Uint32Array([0, 1, 99, 0, 2, 1]),
					},
				},
			]),
		).toThrow("out-of-range vertex");
	});
});

/** Two triangles share their source vertices but use different authored wrap selectors. */
function part(partIndex: number): ResolvedObjectPart {
	return {
		partIndex,
		defaultScale: new Vec3(2, 3, 4),
		materials: [],
		retailVisibility: "normally-visible",
		geometry: {
			id: "geometry:layout-fixture",
			bounds: AABB3.zero(),
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
			textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
			indices: new Uint32Array([0, 1, 2, 0, 2, 1]),
			materialSlotIndices: new Uint16Array([0, 0]),
			materialWrapModes: new Uint8Array([0, 1]),
			materialSideKinds: new Uint8Array(2),
			materialSideTypes: new Uint8Array(2),
			materialStippling: new Uint8Array(2),
			sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		},
	};
}
