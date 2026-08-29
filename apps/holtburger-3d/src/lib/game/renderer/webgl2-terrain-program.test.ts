import { describe, expect, it } from "vitest";
import {
	createTerrainFragmentShader,
	createTerrainVertexShader,
} from "./webgl2-terrain-program";
import { MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER } from "./entity-shadow-policy";

describe("near terrain outdoor PSSM variant", () => {
	it("leaves the ordinary terrain source free of receiver work", () => {
		const source = `${createTerrainVertexShader()}\n${createTerrainFragmentShader()}`;
		expect(source).not.toContain("uOutdoorPssmDepth");
		expect(source).not.toContain("vAmbientWithoutSun");
	});

	it("evaluates visibility per fragment and preserves non-sun lighting", () => {
		const vertex = createTerrainVertexShader("pssm");
		const fragment = createTerrainFragmentShader("pssm");
		expect(vertex).toContain("vAmbientWithoutSun = evaluateAmbient()");
		expect(fragment).toContain(
			"vec3 unshadowedLighting = min(vAmbientSun + runtimeLighting",
		);
		expect(fragment).toContain(
			"vec3 lightingWithoutSun = min(vAmbientWithoutSun + runtimeLighting",
		);
		expect(fragment).toContain("evaluateOutdoorPssmVisibility(");
		expect(fragment).not.toContain("runtimeLighting *");
	});

	it("adds analytic grounding without the PSSM directional split", () => {
		const vertex = createTerrainVertexShader("grounding");
		const fragment = createTerrainFragmentShader("grounding");
		expect(vertex).not.toContain("vAmbientWithoutSun");
		expect(fragment).toContain(
			`MAX_ENTITY_GROUNDING_CASTERS = ${MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER}`,
		);
		expect(fragment).toContain("evaluateEntityGrounding(");
		expect(fragment).not.toContain("uOutdoorPssmDepth");
		expect(fragment.indexOf("evaluateEntityGrounding(")).toBeLessThan(
			fragment.indexOf("color = applyDistanceFog"),
		);
	});
});
