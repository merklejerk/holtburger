import { describe, expect, it } from "vitest";
import {
	STATIC_TRANSPARENT_SORT_DISTANCE,
	STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED,
	formAdjacentTransparentInstanceRuns,
	objectBlendPolicy,
	orderTransparentStaticRanges,
} from "./object-rendering-policy";
import {
	createObjectFragmentShader,
	createObjectVertexShader,
} from "./webgl2-object-program";

describe("orderTransparentStaticRanges", () => {
	it("sorts nearby ranges back-to-front with stable equal-distance ties", () => {
		const ordered = orderTransparentStaticRanges(
			[entry("tie-b", 4), entry("near", 2), entry("far", 8), entry("tie-a", 4)],
			() => 0,
		);

		expect(ordered.near.map(({ stableId }) => stableId)).toEqual([
			"far",
			"tie-a",
			"tie-b",
			"near",
		]);
		expect(ordered.far).toEqual([]);
	});

	it("orders far ranges by deterministic batching compatibility", () => {
		const ordered = orderTransparentStaticRanges(
			[
				{ ...entry("a-2", 40), range: { cohort: "a", id: "a-2" } },
				{ ...entry("b-1", 20), range: { cohort: "b", id: "b-1" } },
				{ ...entry("a-1", 30), range: { cohort: "a", id: "a-1" } },
			],
			(left, right) => left.cohort.localeCompare(right.cohort),
		);

		expect(ordered.far.map(({ range }) => range.id)).toEqual([
			"a-1",
			"a-2",
			"b-1",
		]);
		expect(ordered.near).toEqual([]);
		expect(STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED).toBe(
			STATIC_TRANSPARENT_SORT_DISTANCE * STATIC_TRANSPARENT_SORT_DISTANCE,
		);
	});

	it("separates far candidates from the near camera-sorted phase", () => {
		const ordered = orderTransparentStaticRanges(
			[
				entry("near-first", STATIC_TRANSPARENT_SORT_DISTANCE - 1),
				entry("far-second", STATIC_TRANSPARENT_SORT_DISTANCE + 1),
			],
			() => 0,
		);

		expect(ordered.far.map(({ stableId }) => stableId)).toEqual(["far-second"]);
		expect(ordered.near.map(({ stableId }) => stableId)).toEqual([
			"near-first",
		]);
	});

	it("changes near instance order with camera distance but batches far instances by cohort", () => {
		const sourceOrder = [
			{
				distanceSquared: 152,
				range: { cohort: "a", id: "yellow" },
				stableId: "yellow",
			},
			{
				distanceSquared: 164,
				range: { cohort: "b", id: "blue" },
				stableId: "blue",
			},
			{
				distanceSquared: 240,
				range: { cohort: "a", id: "red" },
				stableId: "red",
			},
		];
		const compareCohorts = (
			left: (typeof sourceOrder)[number]["range"],
			right: (typeof sourceOrder)[number]["range"],
		) => left.cohort.localeCompare(right.cohort);

		expect(
			orderTransparentStaticRanges(sourceOrder, compareCohorts).near.map(
				({ range }) => range.id,
			),
		).toEqual(["red", "blue", "yellow"]);
		const far = orderTransparentStaticRanges(
			sourceOrder.map((entry) => ({
				...entry,
				distanceSquared:
					entry.distanceSquared + STATIC_TRANSPARENT_SORT_DISTANCE_SQUARED * 4,
			})),
			compareCohorts,
		).far;
		expect(far.map(({ range }) => range.id)).toEqual(["red", "yellow", "blue"]);
	});
});

describe("formAdjacentTransparentInstanceRuns", () => {
	it("coalesces only adjacent compatible frame instances after global ordering", () => {
		const ordered = [
			{ cohort: "a", frame: true, id: "a1" },
			{ cohort: "a", frame: true, id: "a2" },
			{ cohort: null, frame: false, id: "baked" },
			{ cohort: "a", frame: true, id: "a3" },
			{ cohort: "b", frame: true, id: "b1" },
		];

		const submissions = formAdjacentTransparentInstanceRuns(
			ordered,
			(value) => value.frame,
			(left, right) => left.cohort === right.cohort,
		);

		expect(
			submissions.map((submission) =>
				submission.kind === "single"
					? submission.value.id
					: submission.values.map(({ id }) => id),
			),
		).toEqual([["a1", "a2"], "baked", ["a3"], ["b1"]]);
	});

	it("does not reunite equal cohorts across an intervening frame cohort", () => {
		const ordered = [
			{ cohort: "a", id: "a1" },
			{ cohort: "b", id: "b1" },
			{ cohort: "a", id: "a2" },
		];

		const submissions = formAdjacentTransparentInstanceRuns(
			ordered,
			() => true,
			(left, right) => left.cohort === right.cohort,
		);

		expect(
			submissions.map((submission) =>
				submission.kind === "single"
					? submission.value.id
					: submission.values.map(({ id }) => id),
			),
		).toEqual([["a1"], ["b1"], ["a2"]]);
	});
});

describe("object fragment variants", () => {
	it("omits fog uniforms and fog code from the blended program", () => {
		expect(createObjectFragmentShader(false)).not.toContain("uFogEnabled");
		expect(createObjectFragmentShader(false)).not.toContain("applyDistanceFog");
		expect(createObjectFragmentShader(true)).toContain("uFogEnabled");
		expect(createObjectVertexShader(false)).not.toContain(
			"uCameraHorizontalPosition",
		);
	});

	it("keeps baked and instanced transform inputs structurally distinct", () => {
		const baked = createObjectVertexShader(true, "baked");
		const instanced = createObjectVertexShader(true, "instanced");

		expect(baked).toContain("uniform mat4 uLocalToLandblock;");
		expect(baked).not.toContain("aSourceToLandblock");
		expect(instanced).not.toContain("uLocalToLandblock");
		expect(instanced).toContain(
			"layout(location = 3) in mat4 aSourceToLandblock;",
		);
		expect(instanced).toContain("layout(location = 7) in vec4 aInstanceColor;");
		expect(createObjectFragmentShader(true)).toContain(
			"vec4 color = sampleMaterial() * vInstanceColor;",
		);
	});

	it("maps palette indices through square palette payloads", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).toContain("uniform vec2 uPaletteSize;");
		expect(shader).toContain(
			"if (index >= paletteSize.x * paletteSize.y) return vec4(0.0);",
		);
		expect(shader).toContain(
			"vec2 paletteCoordinate = vec2(mod(index, paletteSize.x), floor(index / paletteSize.x));",
		);
	});
});

describe("objectBlendPolicy", () => {
	it("preserves retail alpha, inverse-alpha, and additive factor variants", () => {
		expect(objectBlendPolicy(0)).toEqual({
			destination: "one-minus-src-alpha",
			source: "src-alpha",
		});
		expect(objectBlendPolicy(0x100)).toEqual({
			destination: "one-minus-src-alpha",
			source: "src-alpha",
		});
		expect(objectBlendPolicy(0x200)).toEqual({
			destination: "src-alpha",
			source: "one-minus-src-alpha",
		});
		expect(objectBlendPolicy(0x10000)).toEqual({
			destination: "one",
			source: "one",
		});
		expect(objectBlendPolicy(0x10100)).toEqual({
			destination: "one",
			source: "src-alpha",
		});
		expect(objectBlendPolicy(0x10200)).toEqual({
			destination: "one",
			source: "one-minus-src-alpha",
		});
	});
});

function entry(stableId: string, x: number) {
	return { distanceSquared: x * x, range: stableId, stableId };
}
