import { Material, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
	createTextureVelocityMaterialSet,
	deriveTextureVelocityMetrics,
	describeTextureVelocitySignature,
	isTextureVelocityMaterial,
	normalizeTextureVelocity,
	updateTextureVelocityMaterials,
} from "./texture-velocity";

describe("texture velocity", () => {
	it("normalizes zero velocity and produces stable signatures", () => {
		expect(normalizeTextureVelocity(null)).toBeNull();
		expect(normalizeTextureVelocity({ uSpeed: 0, vSpeed: -0 })).toBeNull();
		expect(describeTextureVelocitySignature(null)).toBe("uv:none");
		expect(
			describeTextureVelocitySignature({ uSpeed: 0.125, vSpeed: -0.25 }),
		).toBe("uv:0.125,-0.25");
	});

	it("keeps non-animated material sets cache-owned", () => {
		const material = new MeshBasicMaterial();
		const set = createTextureVelocityMaterialSet([material], null);

		expect(set.ownedByResourceCache).toBe(true);
		expect(set.materials).toEqual([material]);
		expect(isTextureVelocityMaterial(material)).toBe(false);
	});

	it("clones animated material sets and patches shader UV state", () => {
		const material = new MeshBasicMaterial();
		material.customProgramCacheKey = () => "base-program";

		const set = createTextureVelocityMaterialSet([material], {
			uSpeed: 0.5,
			vSpeed: -0.25,
		});
		const animatedMaterial = set.materials[0];
		const shader = createShader();

		animatedMaterial.onBeforeCompile(shader, null as never);
		updateTextureVelocityMaterials([{ material: animatedMaterial }], 9.25);

		expect(set.ownedByResourceCache).toBe(false);
		expect(animatedMaterial).not.toBe(material);
		expect(isTextureVelocityMaterial(animatedMaterial)).toBe(true);
		expect(animatedMaterial.customProgramCacheKey()).toBe(
			"base-program|holtburger-uv-velocity",
		);
		expect(shader.vertexShader).toContain("uniform vec2 holtburgerUvOffset;");
		expect(shader.vertexShader).toContain("vMapUv += holtburgerUvOffset;");
		expect(shader.uniforms.holtburgerUvOffset?.value.toArray()).toEqual([
			0.625, -0.3125,
		]);
	});

	it("derives render metrics without counting cache-owned materials as animated", () => {
		const animatedSet = createTextureVelocityMaterialSet(
			[new MeshBasicMaterial(), new MeshBasicMaterial()],
			{ uSpeed: 0.125, vSpeed: 0 },
		);
		const cacheOwnedMaterial = new MeshBasicMaterial();

		expect(
			deriveTextureVelocityMetrics({
				parts: [
					{
						textureVelocity: { uSpeed: 0.125, vSpeed: 0 },
						textureVelocitySignature: "uv:0.125,0",
					},
					{
						textureVelocity: null,
						textureVelocitySignature: "uv:none",
					},
				],
				groups: [
					{ textureVelocity: { uSpeed: 0.125, vSpeed: 0 } },
					{ textureVelocity: null },
				],
				materialOwners: [
					{ material: animatedSet.materials },
					{ material: cacheOwnedMaterial },
				],
			}),
		).toEqual({
			textureVelocityPartCount: 1,
			textureVelocityRenderGroupCount: 1,
			textureVelocityMaterialCount: 2,
			textureVelocitySignatureCount: 1,
			textureVelocitySignatureSamples: ["uv:0.125,0"],
		});
	});
});

function createShader(): Parameters<Material["onBeforeCompile"]>[0] {
	return {
		uniforms: {},
		vertexShader: "void main() {\n#include <uv_vertex>\n}",
		fragmentShader: "void main() {}",
	};
}
