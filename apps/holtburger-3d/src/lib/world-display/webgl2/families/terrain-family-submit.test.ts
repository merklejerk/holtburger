import { describe, expect, it } from "vitest";

import { describeWebgl2TerrainFamilyFragmentShaderSource } from "./terrain-family-submit";

describe("terrain family submit shader", () => {
	it("samples repeated terrain color atlas entries with explicit gradients", () => {
		const fragmentShader = describeWebgl2TerrainFamilyFragmentShaderSource();

		expect(fragmentShader).toContain("textureGrad(");
		expect(fragmentShader).toContain("dFdx(tiledUv)");
		expect(fragmentShader).toContain("dFdy(tiledUv)");
		expect(fragmentShader).toContain("fract(tiledUv)");
	});

	it("keeps terrain mask sampling on the direct data/control path", () => {
		const fragmentShader = describeWebgl2TerrainFamilyFragmentShaderSource();
		const maskFunction = fragmentShader.slice(
			fragmentShader.indexOf("float sampleMask"),
			fragmentShader.indexOf("void main()"),
		);

		expect(maskFunction).toContain("texture(");
		expect(maskFunction).not.toContain("textureGrad(");
		expect(maskFunction).not.toContain("fract(");
	});
});
