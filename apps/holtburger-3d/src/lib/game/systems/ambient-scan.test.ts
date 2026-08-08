import { describe, expect, it } from "vitest";
import { sceneVector3 } from "../../assets/ac-frame";
import {
	AMBIENT_DIRECTION,
	AMBIENT_MAX_DISTANCE_SQUARED,
	AMBIENT_MIN_DISTANCE,
	ambientDirection,
	ambientWeight,
} from "./ambient-weighting";
import {
	scanAmbientSources,
	type AmbientDescriptor,
	type AmbientTerrainBlock,
} from "./ambient-scan";
import { acVector3 } from "../../assets/ac-frame";

const GRID_SIZE = 9;
const TILE_SIZE = 24;

/** Terrain code 3, scene type 1, no road — the classification the resolver below answers to. */
const AUTHORED_SAMPLE = (3 << 2) | (1 << 11);
/** A classification the resolver returns nothing for. */
const SILENT_SAMPLE = (7 << 2) | (2 << 11);

function descriptor(
	overrides: Partial<AmbientDescriptor> = {},
): AmbientDescriptor {
	return {
		baseChance: 0.5,
		isContinuous: false,
		maxRate: 12,
		minRate: 3,
		soundTableId: "0x20000017",
		soundType: 70,
		tableIndex: 0,
		volume: 1,
		...overrides,
	};
}

/** One landblock whose every cell carries `sample`, with its corner at `origin`. */
function block(
	sample: number,
	origin: readonly [number, number, number],
): AmbientTerrainBlock {
	return {
		gridSize: GRID_SIZE,
		heights: new Float32Array(GRID_SIZE * GRID_SIZE),
		origin: sceneVector3([...origin] as [number, number, number]),
		terrainSamples: new Uint16Array(GRID_SIZE * GRID_SIZE).fill(sample),
		tileSize: TILE_SIZE,
	};
}

const resolver = (terrainCode: number, sceneTypeIndex: number) =>
	terrainCode === 3 && sceneTypeIndex === 1 ? [descriptor()] : null;

describe("ambientWeight", () => {
	it("is flat inside the minimum distance and inverse-square beyond it", () => {
		expect(ambientWeight(0)).toBe(1);
		expect(ambientWeight(AMBIENT_MIN_DISTANCE ** 2)).toBe(1);
		// Twice the flat radius is a quarter of the weight.
		expect(ambientWeight((AMBIENT_MIN_DISTANCE * 2) ** 2)).toBeCloseTo(0.25);
	});

	it("contributes nothing past the maximum distance", () => {
		expect(ambientWeight(AMBIENT_MAX_DISTANCE_SQUARED + 1)).toBe(0);
	});
});

describe("ambientDirection", () => {
	/** AC's x is east and y is north, which is the whole reason this runs in AC axes. */
	it.each([
		{ delta: [0, 100, 0], expected: AMBIENT_DIRECTION.north },
		{ delta: [0, -100, 0], expected: AMBIENT_DIRECTION.south },
		{ delta: [100, 0, 0], expected: AMBIENT_DIRECTION.east },
		{ delta: [-100, 0, 0], expected: AMBIENT_DIRECTION.west },
		{ delta: [-70, 70, 0], expected: AMBIENT_DIRECTION.northwest },
		{ delta: [-70, -70, 0], expected: AMBIENT_DIRECTION.southwest },
		{ delta: [70, 70, 0], expected: AMBIENT_DIRECTION.northeast },
		{ delta: [70, -70, 0], expected: AMBIENT_DIRECTION.southeast },
	])("buckets $delta", ({ delta, expected }) => {
		expect(ambientDirection(acVector3(delta as [number, number, number]))).toBe(
			expected,
		);
	});

	it("has no direction for a source the listener is standing on", () => {
		expect(ambientDirection(acVector3([1, 1, 0]))).toBe(
			AMBIENT_DIRECTION.inViewerBlock,
		);
	});

	it("keeps a dominant axis rather than rounding to a diagonal", () => {
		// |y| / |x| is 3, past the 2:1 dominance ratio, so this is north rather than northeast.
		expect(ambientDirection(acVector3([30, 90, 0]))).toBe(
			AMBIENT_DIRECTION.north,
		);
	});
});

describe("scanAmbientSources", () => {
	it("accumulates weight in every direction when the listener is surrounded", () => {
		// Listener at the middle of a block whose every cell authors the same sound.
		const middle = sceneVector3([4 * TILE_SIZE, 0, -4 * TILE_SIZE]);
		const result = scanAmbientSources(
			middle,
			[block(AUTHORED_SAMPLE, [0, 0, 0])],
			resolver,
		);

		const accumulation = result.accumulations.get("0:70");
		expect(accumulation).toBeDefined();
		expect(accumulation!.soundCount).toBeGreaterThan(0);
		expect(accumulation!.directions.size).toBe(8);
		expect(result.totalWeight).toBeCloseTo(accumulation!.soundCount);
	});

	/** The property that makes ambience feel located rather than ambient-everywhere. */
	it("accumulates only toward the authoring side at a terrain boundary", () => {
		// The authoring block sits due north of the listener; the block it stands on is silent.
		const listener = sceneVector3([4 * TILE_SIZE, 0, 0]);
		const result = scanAmbientSources(
			listener,
			[
				block(SILENT_SAMPLE, [0, 0, 0]),
				block(AUTHORED_SAMPLE, [0, 0, -3 * TILE_SIZE]),
			],
			resolver,
		);

		const accumulation = result.accumulations.get("0:70");
		expect(accumulation).toBeDefined();
		const directions = [...accumulation!.directions.keys()];
		expect(directions).toContain(AMBIENT_DIRECTION.north);
		expect(directions).not.toContain(AMBIENT_DIRECTION.south);
	});

	it("finds nothing when every authoring cell is out of range", () => {
		// Far past the 120 m maximum.
		const listener = sceneVector3([0, 0, 5000]);
		const result = scanAmbientSources(
			listener,
			[block(AUTHORED_SAMPLE, [0, 0, 0])],
			resolver,
		);

		expect(result.accumulations.size).toBe(0);
		expect(result.totalWeight).toBe(0);
		expect(result.examinedCellCount).toBe(0);
	});

	it("gives a continuous descriptor weight but never a direction", () => {
		const continuousResolver = () => [descriptor({ isContinuous: true })];
		const result = scanAmbientSources(
			sceneVector3([4 * TILE_SIZE, 0, -4 * TILE_SIZE]),
			[block(AUTHORED_SAMPLE, [0, 0, 0])],
			continuousResolver,
		);

		const accumulation = result.accumulations.get("0:70");
		expect(accumulation!.soundCount).toBeGreaterThan(0);
		// Retail's `ConstantSound::AddTo` accumulates weight and nothing else; it is played centred.
		expect(accumulation!.directions.size).toBe(0);
	});

	it("widens a direction's band rather than keeping only the nearest contributor", () => {
		const listener = sceneVector3([4 * TILE_SIZE, 0, 0]);
		const result = scanAmbientSources(
			listener,
			[block(AUTHORED_SAMPLE, [0, 0, -3 * TILE_SIZE])],
			resolver,
		);

		const band = result.accumulations
			.get("0:70")!
			.directions.get(AMBIENT_DIRECTION.north);
		expect(band).toBeDefined();
		// Several rows of cells contribute, so the band spans more than one cell's ±10 m.
		expect(band!.maximum - band!.minimum).toBeGreaterThan(AMBIENT_MIN_DISTANCE);
	});
});
