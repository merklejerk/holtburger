import { describe, expect, it } from "vitest";
import {
	createTerrainFragmentShader,
	createTerrainVertexShader,
} from "./webgl2-terrain-program";
import { MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER } from "./entity-shadow-policy";

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

	it("adds directional capsules without the PSSM sampler", () => {
		const vertex = createTerrainVertexShader("directional");
		const fragment = createTerrainFragmentShader("directional");
		expect(vertex).toContain("vAmbientWithoutSun");
		expect(fragment).toContain(
			`MAX_OUTDOOR_DIRECTIONAL_SHADOW_CASTERS = ${MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER}`,
		);
		expect(fragment).toContain("evaluateOutdoorDirectionalShadowVisibility(");
		expect(fragment).toContain("uOutdoorDirectionalShadowTailStrength");
		expect(fragment).toContain("smoothstep(0.5, 1.0, along)");
		expect(fragment).not.toContain("uOutdoorPssmDepth");
		expect(
			fragment.indexOf("evaluateOutdoorDirectionalShadowVisibility("),
		).toBeLessThan(fragment.indexOf("color = applyDistanceFog"));
	});

	it("composes mapped and analytic tiers as strongest regional-sun occlusion", () => {
		const fragment = createTerrainFragmentShader("hybrid");
		expect(fragment).toContain("min(evaluateOutdoorPssmVisibility(");
		expect(fragment).toContain(
			"), evaluateOutdoorDirectionalShadowVisibility(",
		);
		expect(fragment).toContain("vec3 lightingWithoutSun");
	});
});
