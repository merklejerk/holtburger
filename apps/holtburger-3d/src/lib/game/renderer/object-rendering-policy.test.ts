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

	it("filters indexed textures only after exact palette lookup", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).toContain(
			"vec2 texelPosition = uv * vec2(sourceSize) - vec2(0.5);",
		);
		expect(shader).toContain(
			"vec4 encoded = texelFetch(uBase, atlasCoordinate, 0) * 255.0;",
		);
		expect(shader).toContain("ivec2(uPaletteRect.xy + paletteCoordinate)");
		expect(shader).toContain("indexedColorAt(baseCoordinate, sourceSize)");
		expect(shader).toContain(
			"indexedColorAt(baseCoordinate + ivec2(1, 0), sourceSize)",
		);
		expect(shader).toContain(
			"indexedColorAt(baseCoordinate + ivec2(0, 1), sourceSize)",
		);
		expect(shader).toContain(
			"indexedColorAt(baseCoordinate + ivec2(1, 1), sourceSize)",
		);
		expect(shader).toContain("return mix(top, bottom, blend.y);");
	});

	it("reconstructs index16 values and wraps each bilinear tap within the source rect", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).toContain(
			"floor(encoded.r + 0.5) + floor(encoded.g + 0.5) * 256.0",
		);
		expect(shader).toContain("((coordinate.x % size.x) + size.x) % size.x");
		expect(shader).toContain(
			"return clamp(coordinate, ivec2(0), size - ivec2(1));",
		);
	});

	it("turns clipped palette taps transparent before blending and alpha testing", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).toContain(
			"if (uPalettedClipMap != 0 && index < 8.0) return vec4(0.0);",
		);
		expect(shader).toContain(
			"vec4 indexed = sampleIndexedPaletteLinear(uv) * uMaterialColor;",
		);
		expect(shader).toContain("if (indexed.a < uAlphaTest) discard;");
		expect(shader).not.toContain("index < 8.0) discard");
	});

	it("maps palette indices through pixel-space palette rectangles", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).not.toContain("uPaletteSize");
		expect(shader).toContain(
			"vec2 paletteSize = max(uPaletteRect.zw, vec2(1.0));",
		);
		expect(shader).toContain(
			"if (index >= paletteSize.x * paletteSize.y) return vec4(0.0);",
		);
		expect(shader).toContain("mod(index, paletteSize.x)");
		expect(shader).toContain("floor(index / paletteSize.x)");
	});

	it("composes static detail with retail destination-color blending", () => {
		const shader = createObjectFragmentShader(false);
		const luminosity = "color.rgb += vec3(max(uLuminosity, 0.0));";
		const detailBlend = "color.rgb * (detail.rgb + (1.0 - detailAlpha))";

		expect(shader).toContain("float detailAlpha = clamp(detail.a, 0.0, 1.0);");
		expect(shader).toContain(detailBlend);
		expect(shader).toContain("if (uUseDetail != 0)");
		expect(shader).not.toContain("mix(color.rgb, detail.rgb, detail.a)");
		expect(shader.indexOf(luminosity)).toBeLessThan(
			shader.indexOf(detailBlend),
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
