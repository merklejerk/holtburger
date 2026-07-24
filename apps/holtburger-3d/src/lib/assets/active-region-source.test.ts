import { describe, expect, it } from "vitest";
import { decodeActiveRegionSource } from "./active-region-source";

describe("decodeActiveRegionSource", () => {
	it("installs complete static data and the binary height table", () => {
		const source = decodeActiveRegionSource(activeRegionResponse());
		expect(source.provenance).toMatchObject({
			sourceRecordId: "0x13000000",
			number: 1,
		});
		expect(source.data.calendar.timesOfDay[0]?.name).toBe("Dawn");
		expect(source.landHeightTable[42]).toBeCloseTo(42.5);
	});

	it("rejects a malformed height-table section", () => {
		expect(() =>
			decodeActiveRegionSource(activeRegionResponse({ byteLength: 4 })),
		).toThrow("incompatible contract");
	});
});

function activeRegionResponse(section = { byteLength: 1024 }): Uint8Array {
	const manifest = new TextEncoder().encode(
		JSON.stringify({
			transport: "holtburger-active-region-data",
			version: 1,
			byteOrder: "little-endian",
			sectionByteOffsetBase: "section-data",
			provenance: {
				sourceRecordId: "0x13000000",
				number: 1,
				version: 3,
				name: "Dereth",
				partsMask: 0x21f,
			},
			data: {
				land: {
					numBlockLength: 255,
					numBlockWidth: 255,
					squareLength: 24,
					landblockLength: 192,
					verticesPerCell: 8,
					maxObjectHeight: 64,
					skyHeight: 500,
					roadWidth: 1,
				},
				calendar: {
					zeroTimeOfYear: 0,
					zeroYear: 0,
					dayLength: 1,
					daysPerYear: 365,
					yearSpec: "year",
					timesOfDay: [{ start: 0, isNight: false, name: "Dawn" }],
					daysOfTheWeek: [],
					seasons: [],
				},
				sky: null,
				sound: null,
				scenes: null,
				terrain: null,
				misc: null,
			},
			sections: [
				{
					name: "landHeightTable",
					scalarType: "f32",
					elementCount: 256,
					byteOffset: 0,
					byteLength: section.byteLength,
				},
			],
		}),
	);
	const paddedManifestLength = Math.ceil((16 + manifest.length) / 4) * 4 - 16;
	const response = new Uint8Array(16 + paddedManifestLength + 1024);
	response.set(new TextEncoder().encode("HBAR"), 0);
	const view = new DataView(response.buffer);
	view.setUint32(4, 1, true);
	view.setUint32(8, paddedManifestLength, true);
	view.setUint32(12, response.byteLength, true);
	response.set(manifest, 16);
	response.fill(0x20, 16 + manifest.length, 16 + paddedManifestLength);
	const heights = new Float32Array(
		response.buffer,
		16 + paddedManifestLength,
		256,
	);
	for (let index = 0; index < heights.length; index += 1) {
		heights[index] = index + 0.5;
	}
	return response;
}
