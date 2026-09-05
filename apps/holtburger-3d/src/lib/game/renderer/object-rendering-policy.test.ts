import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	areStaticObjectDrawsCompatible,
	createObjectSubmissionPhases,
	formAdjacentObjectInstanceRuns,
	formGroupedObjectInstanceRuns,
	objectBlendPolicy,
	orderTransparentObjectRanges,
	type PreparedStaticObjectDrawCompatibility,
} from "./object-rendering-policy";
import {
	createObjectFragmentShader,
	createPortalObjectFragmentShader,
	createObjectVertexShader,
} from "./webgl2-object-program";

const TRANSPARENT_TUNING = SHARED_FRONTEND_TUNING.rendering.transparentObjects;

describe("orderTransparentObjectRanges", () => {
	it("orders nearby ranges exactly back-to-front by camera depth", () => {
		const ordered = orderTransparentObjectRanges(
			[
				entry("radially-farther", 12, 4),
				entry("depth-farther", 10, 9),
				entry("depth-nearer", 8, 2),
			],
			() => null,
			depthOf,
		);

		expect(ordered.near.map(({ range }) => range)).toEqual([
			"depth-farther",
			"radially-farther",
			"depth-nearer",
		]);
		expect(ordered.far).toEqual([]);
		expect(ordered.trace).toEqual({
			cameraDepthEvaluationCount: 3,
			distanceClassificationCount: 3,
			farBatchKeyEvaluationCount: 0,
		});
	});

	it("breaks equal-depth ties by stable physical identity", () => {
		const ordered = orderTransparentObjectRanges(
			[entry("z", 4, 3), entry("a", 4, 3)],
			() => null,
			depthOf,
		);

		expect(ordered.near.map(({ range }) => range)).toEqual(["a", "z"]);
	});

	it("groups far ranges by first-seen batching cohort", () => {
		depthEvaluations.length = 0;
		const ordered = orderTransparentObjectRanges(
			[
				{ ...entry("a-2", 40), range: { cohort: "a", id: "a-2" } },
				{ ...entry("b-1", 20), range: { cohort: "b", id: "b-1" } },
				{ ...entry("a-1", 30), range: { cohort: "a", id: "a-1" } },
			],
			({ cohort }) => cohort,
			({ id }) => depthOf(id),
		);

		expect(ordered.far.map(({ range }) => range.id)).toEqual([
			"a-2",
			"a-1",
			"b-1",
		]);
		expect(ordered.near).toEqual([]);
		expect(ordered.trace.farBatchKeyEvaluationCount).toBe(3);
		// The far majority is the whole population here; none of it may pay for a camera depth.
		expect(depthEvaluations).toEqual([]);
		expect(ordered.trace.cameraDepthEvaluationCount).toBe(0);
	});

	it("derives camera depth only for near candidates", () => {
		depthEvaluations.length = 0;
		const ordered = orderTransparentObjectRanges(
			[
				entry("far", TRANSPARENT_TUNING.nearDistance + 1),
				entry("near", TRANSPARENT_TUNING.nearDistance - 1),
			],
			() => null,
			depthOf,
		);

		expect(depthEvaluations).toEqual(["near"]);
		expect(ordered.trace.cameraDepthEvaluationCount).toBe(1);
	});

	it("separates far candidates from the near camera-sorted phase", () => {
		const ordered = orderTransparentObjectRanges(
			[
				entry("near-first", TRANSPARENT_TUNING.nearDistance - 1),
				entry("far-second", TRANSPARENT_TUNING.nearDistance + 1),
			],
			() => null,
			depthOf,
		);

		expect(ordered.far.map(({ range }) => range)).toEqual(["far-second"]);
		expect(ordered.near.map(({ range }) => range)).toEqual(["near-first"]);
	});

	it.each([
		["camera distance", { ...entry("range", 1), distanceSquared: -1 }],
		["stable identity", { ...entry("range", 1), stableId: "" }],
	])("rejects invalid transparent %s", (_label, range) => {
		expect(() =>
			orderTransparentObjectRanges([range], () => null, depthOf),
		).toThrow(`Transparent object ${_label}`);
	});

	it("rejects a near candidate whose derived camera depth is not finite", () => {
		expect(() =>
			orderTransparentObjectRanges(
				[entry("near", TRANSPARENT_TUNING.nearDistance - 1)],
				() => null,
				() => Number.NaN,
			),
		).toThrow("Transparent object camera depth");
	});
});

describe("createObjectSubmissionPhases", () => {
	it.each([
		{ cameraOffset: -0.2, direction: 1, expected: [["a", "b"], "dynamic"] },
		{ cameraOffset: 0, direction: 1, expected: [["b"], "dynamic", ["a"]] },
		{ cameraOffset: 0.2, direction: 1, expected: [["b"], "dynamic", ["a"]] },
		{ cameraOffset: 0.2, direction: -1, expected: [["a"], "dynamic", ["b"]] },
	])(
		"reclassifies static instances across the near boundary at $cameraOffset facing $direction",
		({ cameraOffset, direction, expected }) => {
			const radius = TRANSPARENT_TUNING.nearDistance;
			const objects = [
				{ id: "a", x: radius * 0.9, instanced: true },
				{ id: "dynamic", x: radius * 0.95, instanced: false },
				{ id: "b", x: radius * 1.1, instanced: true },
			].map((value) => ({ ...value, ordering: "transparent" as const }));
			const phases = createObjectSubmissionPhases(
				objects,
				(value) => ({
					range: value,
					stableId: value.id,
					distanceSquared: (value.x - cameraOffset * radius) ** 2,
				}),
				(value) => (value.instanced ? "shared" : null),
				(value) => direction * (value.x - cameraOffset * radius),
			);
			// Far cohorts may regroup; near instances must not cross an intervening dynamic draw.
			const submissions = [
				phases.transparent.far,
				phases.transparent.near,
			].flatMap((ordered) =>
				formAdjacentObjectInstanceRuns(
					ordered,
					(value) => value.instanced,
					() => true,
				),
			);
			expect(
				submissions.map((submission) =>
					submission.kind === "single"
						? submission.value.id
						: submission.values.map((value) => value.id),
				),
			).toEqual(expected);
		},
	);

	it("keeps a merged dynamic range between compatible generated instances after near sorting", () => {
		const objects = [
			{ id: "near-static", depth: 2, drawKind: "instanced" },
			{ id: "far-static", depth: 6, drawKind: "instanced" },
			{ id: "dynamic", depth: 4, drawKind: "merged" },
			{ id: "far-static-neighbor", depth: 5, drawKind: "instanced" },
		].map((value) => ({ ...value, ordering: "transparent" as const }));
		const phases = createObjectSubmissionPhases(
			objects,
			(object) => ({
				range: object,
				stableId: object.id,
				distanceSquared: (TRANSPARENT_TUNING.nearDistance / 2) ** 2,
			}),
			() => "shared-cohort",
			(object) => object.depth,
		);
		const submissions = formAdjacentObjectInstanceRuns(
			phases.transparent.near,
			(object) => object.drawKind === "instanced",
			() => true,
		);
		expect(
			submissions.map((submission) =>
				submission.kind === "single"
					? submission.value.id
					: submission.values.map((value) => value.id),
			),
		).toEqual([
			["far-static", "far-static-neighbor"],
			"dynamic",
			["near-static"],
		]);
		expect(phases.transparent.far).toEqual([]);
	});

	it("partitions one physical population and globally orders transparency", () => {
		const sortFactCalls: string[] = [];
		const batchCalls: string[] = [];
		const objects = [
			{ cohort: null, distance: 0, id: "wall", ordering: "opaque" },
			{
				cohort: "glass",
				distance: TRANSPARENT_TUNING.nearDistance + 2,
				id: "far-glass-a",
				ordering: "transparent",
			},
			{ cohort: null, distance: 0, id: "fence", ordering: "alpha-test" },
			{
				cohort: null,
				distance: TRANSPARENT_TUNING.nearDistance - 1,
				id: "near-glass",
				ordering: "transparent",
			},
			{ cohort: null, distance: 0, id: "glow", ordering: "additive" },
			{
				cohort: "glass",
				distance: TRANSPARENT_TUNING.nearDistance + 1,
				id: "far-glass-b",
				ordering: "transparent",
			},
		] as const;

		const depthCalls: string[] = [];
		const phases = createObjectSubmissionPhases(
			objects,
			(object) => {
				sortFactCalls.push(object.id);
				return {
					distanceSquared: object.distance ** 2,
					range: object,
					stableId: object.id,
				};
			},
			(object) => {
				batchCalls.push(object.id);
				return object.cohort;
			},
			(object) => {
				depthCalls.push(object.id);
				return object.distance;
			},
		);

		expect(phases.opaque.map(({ id }) => id)).toEqual(["wall", "fence"]);
		expect(phases.transparent.far.map(({ id }) => id)).toEqual([
			"far-glass-a",
			"far-glass-b",
		]);
		expect(phases.transparent.near.map(({ id }) => id)).toEqual(["near-glass"]);
		expect(phases.additive.map(({ id }) => id)).toEqual(["glow"]);
		expect(sortFactCalls).toEqual(["far-glass-a", "near-glass", "far-glass-b"]);
		expect(batchCalls).toEqual(["far-glass-a", "far-glass-b"]);
		expect(depthCalls).toEqual(["near-glass"]);
	});
});

describe("formAdjacentObjectInstanceRuns", () => {
	it("coalesces only adjacent compatible frame instances after global ordering", () => {
		const ordered = [
			{ cohort: "a", frame: true, id: "a1" },
			{ cohort: "a", frame: true, id: "a2" },
			{ cohort: null, frame: false, id: "baked" },
			{ cohort: "a", frame: true, id: "a3" },
			{ cohort: "b", frame: true, id: "b1" },
		];

		const submissions = formAdjacentObjectInstanceRuns(
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

		const submissions = formAdjacentObjectInstanceRuns(
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

	it("keeps identical part batches separated across render domains", () => {
		const ordered = [
			{ batch: "wing", domain: "outdoor", id: "a" },
			{ batch: "wing", domain: "outdoor", id: "b" },
			{ batch: "wing", domain: "cell:1", id: "c" },
		];

		expect(
			formAdjacentObjectInstanceRuns(
				ordered,
				() => true,
				(left, right) =>
					left.batch === right.batch && left.domain === right.domain,
			),
		).toEqual([
			{ kind: "frame-instance-run", values: ordered.slice(0, 2) },
			{ kind: "frame-instance-run", values: ordered.slice(2) },
		]);
	});
});

describe("formGroupedObjectInstanceRuns", () => {
	it("coalesces separated compatible cohorts in first-seen group order", () => {
		const ordered = [
			{ cohort: "a", compatible: "red", frame: true, id: "a1" },
			{ cohort: null, compatible: "baked", frame: false, id: "baked" },
			{ cohort: "b", compatible: "blue", frame: true, id: "b1" },
			{ cohort: "a", compatible: "red", frame: true, id: "a2" },
		];

		const submissions = formGroupedObjectInstanceRuns(
			ordered,
			(value) => value.frame,
			(value) => value.cohort ?? "",
			(left, right) => left.compatible === right.compatible,
		);

		expect(
			submissions.map((submission) =>
				submission.kind === "single"
					? submission.value.id
					: submission.values.map(({ id }) => id),
			),
		).toEqual([["a1", "a2"], "baked", ["b1"]]);
	});

	it("splits a semantic cohort when exact compatibility differs", () => {
		const ordered = [
			{ cohort: "a", state: "red", id: "red-1" },
			{ cohort: "a", state: "blue", id: "blue" },
			{ cohort: "a", state: "red", id: "red-2" },
		];

		expect(
			formGroupedObjectInstanceRuns(
				ordered,
				() => true,
				(value) => value.cohort,
				(left, right) => left.state === right.state,
			),
		).toEqual([
			{ kind: "frame-instance-run", values: [ordered[0], ordered[2]] },
			{ kind: "frame-instance-run", values: [ordered[1]] },
		]);
	});
});

describe("areStaticObjectDrawsCompatible", () => {
	it("accepts equal consumed state despite unrelated fragment provenance", () => {
		const compatibility = staticCompatibility();
		const left = { compatibility, sourceNode: "cluster:a" };
		const right = {
			compatibility: { ...compatibility },
			sourceNode: "cluster:b",
		};

		expect(
			areStaticObjectDrawsCompatible(left.compatibility, right.compatibility),
		).toBe(true);
	});

	it("rejects every changed draw-consumed compatibility field", () => {
		const baseline = staticCompatibility();
		const otherGeometry = identity("geometry:b");
		const otherTexture = identity("texture:b");
		const otherSampler = identity("sampler:b");
		const incompatible: readonly AnyStaticCompatibility[] = [
			{ ...baseline, geometry: otherGeometry },
			{ ...baseline, indexStart: 4 },
			{ ...baseline, indexCount: 9 },
			{ ...baseline, cullFace: "front" },
			{ ...baseline, wrapRepeat: true },
			{ ...baseline, palettedClipMap: true },
			{ ...baseline, alphaTest: 0 },
			{ ...baseline, luminosity: 0.5 },
			{
				...baseline,
				material: { ...baseline.material, kind: "index16" },
			},
			{
				...baseline,
				material: { ...baseline.material, color: [0.5, 1, 1, 1] },
			},
			{
				...baseline,
				material: {
					...baseline.material,
					base: { ...baseline.material.base, texture: otherTexture },
				},
			},
			{
				...baseline,
				material: {
					...baseline.material,
					base: { ...baseline.material.base, sampler: otherSampler },
				},
			},
			{
				...baseline,
				material: {
					...baseline.material,
					base: { ...baseline.material.base, rect: [1, 2, 4, 4] },
				},
			},
			{
				...baseline,
				material: {
					...baseline.material,
					palette: { ...baseline.material.palette, texture: otherTexture },
				},
			},
			{
				...baseline,
				material: {
					...baseline.material,
					palette: { ...baseline.material.palette, sampler: otherSampler },
				},
			},
			{
				...baseline,
				material: {
					...baseline.material,
					palette: { ...baseline.material.palette, rect: [0, 0, 32, 1] },
				},
			},
			{ ...baseline, detail: null },
			{
				...baseline,
				detail: { ...baseline.detail, texture: otherTexture },
			},
			{
				...baseline,
				detail: { ...baseline.detail, sampler: otherSampler },
			},
			{
				...baseline,
				detail: { ...baseline.detail, rect: [0, 0, 0.5, 1] },
			},
			{ ...baseline, detail: { ...baseline.detail, tiling: 8 } },
		];

		for (const candidate of incompatible) {
			expect(areStaticObjectDrawsCompatible(baseline, candidate)).toBe(false);
		}
	});

	it("keeps solid-color compatibility independent from unused texture state", () => {
		const baseline = staticCompatibility();
		const solid = {
			...baseline,
			detail: null,
			material: {
				color: [0.25, 0.5, 0.75, 1] as const,
				kind: "solid-color" as const,
			},
		};

		expect(areStaticObjectDrawsCompatible(solid, { ...solid })).toBe(true);
		expect(
			areStaticObjectDrawsCompatible(solid, {
				...solid,
				material: { ...solid.material, color: [0.25, 0.5, 0.75, 0.5] },
			}),
		).toBe(false);
	});
});

describe("object fragment variants", () => {
	it("applies the scope envelope before sampling a portal-deferred material", () => {
		const shader = createPortalObjectFragmentShader(false);
		const visibility = shader.indexOf(
			"if (!portalDeferredFragmentVisible()) discard;",
		);
		const material = shader.indexOf(
			"vec4 color = sampleMaterial() * vInstanceColor;",
		);

		expect(shader).toContain("uniform uint uPortalRenderDomain;");
		expect(shader).toContain("uScopes[uPortalRenderDomain]");
		expect(shader).toContain("gl_FragCoord.z * 0.5 < envelopeDepth");
		expect(visibility).toBeGreaterThan(-1);
		expect(visibility).toBeLessThan(material);
	});

	it("guards every texture sample behind the material state that enables it", () => {
		const shader = createObjectFragmentShader(false);
		const solidReturn = shader.indexOf(
			"if (uMaterialKind == 0) return uMaterialColor;",
		);
		const baseSample = shader.indexOf("sampleRepeatingPixelRect(uBase");
		const directReturn = shader.indexOf("return direct;");
		const paletteSample = shader.indexOf("sampleIndexedPaletteLinear(uv)");
		const detailGuard = shader.indexOf("if (uUseDetail != 0)");
		const detailSample = shader.indexOf(
			"sampleRepeatingAtlasRect(\n\t\t\tuDetail",
		);

		expect(solidReturn).toBeGreaterThan(-1);
		expect(solidReturn).toBeLessThan(baseSample);
		expect(directReturn).toBeLessThan(paletteSample);
		expect(detailGuard).toBeLessThan(detailSample);
	});

	it("omits fog uniforms and fog code from the blended program", () => {
		expect(createObjectFragmentShader(false)).not.toContain("uFogEnabled");
		expect(createObjectFragmentShader(false)).not.toContain("applyDistanceFog");
		expect(createObjectFragmentShader(true)).toContain("uFogEnabled");
		expect(createObjectVertexShader(false)).not.toContain(
			"uCameraHorizontalPosition",
		);
	});

	it("keeps uniform and attribute transform inputs structurally distinct", () => {
		const baked = createObjectVertexShader(true, "uniform");
		const instanced = createObjectVertexShader(true, "attribute");

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

	it("preserves continuous gradients across repeated direct and detail texture seams", () => {
		const shader = createObjectFragmentShader(false);
		expect(shader).toContain(
			"vec2 atlasUv = rectOrigin + fract(continuousSource) * rectExtent;",
		);
		expect(shader).toContain(
			"vec2 atlasGradientX = dFdx(continuousSource) * rectExtent;",
		);
		expect(shader).toContain(
			"vec2 atlasGradientY = dFdy(continuousSource) * rectExtent;",
		);
		expect(shader).toContain(
			"return textureGrad(atlasTexture, atlasUv, atlasGradientX, atlasGradientY);",
		);
		expect(shader).toContain(
			"? sampleRepeatingPixelRect(uBase, vTextureCoordinate, uBaseRect)",
		);
		expect(shader).toContain("vTextureCoordinate * uDetailTiling,");
		expect(shader).not.toContain(
			"atlasUv(fract(vTextureCoordinate * uDetailTiling), uDetailRect)",
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

/**
 * One classified candidate plus the depth the lazy near-phase callback would derive for it.
 *
 * Depth is carried beside the range rather than inside it, mirroring production: classification
 * never sees a camera depth, and only near candidates ever have one derived.
 */
function entry(
	stableId: string,
	radialDistance: number,
	cameraDepth = radialDistance,
) {
	cameraDepths.set(stableId, cameraDepth);
	return {
		distanceSquared: radialDistance * radialDistance,
		range: stableId,
		stableId,
	};
}

const cameraDepths = new Map<string, number>();

/** Lazy depth source recording which candidates the ordering policy actually asked about. */
function depthOf(range: string): number {
	depthEvaluations.push(range);
	const depth = cameraDepths.get(range);
	if (depth === undefined) throw new Error(`No camera depth for ${range}.`);
	return depth;
}

const depthEvaluations: string[] = [];

interface TestIdentity {
	readonly name: string;
}

type AnyStaticCompatibility = PreparedStaticObjectDrawCompatibility<
	TestIdentity,
	TestIdentity,
	TestIdentity
>;

type StaticCompatibility = Omit<
	AnyStaticCompatibility,
	"detail" | "material"
> & {
	readonly material: Extract<
		AnyStaticCompatibility["material"],
		{ readonly palette: unknown }
	>;
	readonly detail: NonNullable<AnyStaticCompatibility["detail"]>;
};

function identity(name: string): TestIdentity {
	return { name };
}

function staticCompatibility(): StaticCompatibility {
	const sampler = identity("sampler:a");
	return {
		alphaTest: 200 / 255,
		cullFace: "back",
		detail: {
			rect: [0, 0, 1, 1],
			sampler,
			texture: identity("texture:detail"),
			tiling: 4,
		},
		geometry: identity("geometry:a"),
		indexCount: 6,
		indexStart: 0,
		luminosity: 0,
		material: {
			base: {
				rect: [0, 0, 4, 4],
				sampler,
				texture: identity("texture:base"),
			},
			color: [1, 1, 1, 1],
			kind: "index8",
			palette: {
				rect: [0, 0, 16, 1],
				sampler,
				texture: identity("texture:palette"),
			},
		},
		palettedClipMap: false,
		wrapRepeat: false,
	};
}
