import { describe, expect, it } from "vitest";
import {
	createPssmCasterFragmentShader,
	createPssmCasterVertexShader,
} from "./webgl2-pssm-caster-program";

describe("PSSM caster shader", () => {
	it("uses only rigid geometry, instance transforms, and anchor-relative light clip", () => {
		const source = createPssmCasterVertexShader();
		expect(source).toContain("layout(location = 0) in vec3 aPosition");
		expect(source).toContain("layout(location = 3) in mat4 aSourceToLandblock");
		expect(source).toContain("uniform mat4 uLightClip");
		expect(source).toContain("uniform vec3 uLandblockOffset");
		expect(source).not.toContain("aTextureCoordinate");
		expect(source).not.toContain("aInstanceColor");
		expect(source).not.toContain("sampler");
	});

	it("owns no color output or material sampling", () => {
		const source = createPssmCasterFragmentShader();
		expect(source).toContain("void main() {}");
		expect(source).not.toContain("out vec4");
		expect(source).not.toContain("sampler");
		expect(source).not.toContain("discard");
	});
});
