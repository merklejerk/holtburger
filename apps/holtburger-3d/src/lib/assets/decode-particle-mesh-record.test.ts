import { describe, expect, it } from "vitest";
import { decodeParticleMeshRecord } from "./decode-particle-mesh-record";

/** The geometry sections the host always writes, all empty for a fixture with no vertices. */
const SECTIONS = [
	"positions",
	"normals",
	"textureCoordinates",
	"indices",
	"materialSlots",
	"materialWrapModes",
	"materialSideKinds",
	"materialSideTypes",
	"materialStippling",
].map((name) => ({
	byteLength: 0,
	byteOffset: 0,
	elementCount: 0,
	name,
	scalarType: name === "positions" ||
	name === "normals" ||
	name === "textureCoordinates"
		? "f32"
		: name === "indices"
			? "u32"
			: name === "materialSlots"
				? "u16"
				: "u8",
}));

function encode(overrides: Record<string, unknown> = {}): Uint8Array {
	const manifest = {
		byteOrder: "little-endian",
		definitions: [],
		geometries: [],
		materials: [],
		meshes: [{ hwGfxObjId: "0x01000ff4", source: "gfx-obj/01000ff4" }],
		sectionByteOffsetBase: "section-data",
		sections: SECTIONS,
		textureDependencies: [],
		transport: "holtburger-particle-mesh",
		...overrides,
	};
	let body = new TextEncoder().encode(JSON.stringify(manifest));
	while ((12 + body.length) % 4 !== 0) body = Uint8Array.from([...body, 0x20]);
	const bytes = new Uint8Array(12 + body.length);
	bytes.set(new TextEncoder().encode("HBPM"), 0);
	new DataView(bytes.buffer).setUint32(4, body.length, true);
	new DataView(bytes.buffer).setUint32(8, bytes.length, true);
	bytes.set(body, 12);
	return bytes;
}

describe("decodeParticleMeshRecord", () => {
	it("rejects a mesh whose definition is absent from the closure", () => {
		// A dangling source would silently produce an emitter that draws nothing.
		expect(() => decodeParticleMeshRecord(encode())).toThrow(
			"references missing source",
		);
	});

	it("rejects a record with no meshes", () => {
		expect(() => decodeParticleMeshRecord(encode({ meshes: [] }))).toThrow(
			"invalid",
		);
	});

	it("rejects a length that disagrees with its header", () => {
		const bytes = encode();
		new DataView(bytes.buffer).setUint32(8, bytes.length + 4, true);
		expect(() => decodeParticleMeshRecord(bytes)).toThrow("header declares");
	});

	it("rejects an unexpected magic", () => {
		const bytes = encode();
		bytes.set(new TextEncoder().encode("XXXX"), 0);
		expect(() => decodeParticleMeshRecord(bytes)).toThrow("magic");
	});
});
