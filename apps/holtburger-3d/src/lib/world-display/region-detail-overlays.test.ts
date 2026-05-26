import { MeshBasicMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";

import {
	applyRegionDetailOverlayToMaterials,
	type ResolvedRegionDetailOverlay,
} from "./region-detail-overlays";

describe("applyRegionDetailOverlayToMaterials", () => {
	it("approximates retail destination-color detail blending for building and environment roles", () => {
		const material = new MeshBasicMaterial({ map: new Texture() });
		const result = applyRegionDetailOverlayToMaterials({
			materials: [material],
			overlay: createResolvedDetailOverlay(),
		});
		const shader = {
			uniforms: {},
			fragmentShader: "void main() {\n#include <color_fragment>\n}",
		};

		result.materials[0]?.onBeforeCompile(shader);

		expect(shader.fragmentShader).toContain(
			"holtburgerRegionDetailColor.rgb + (1.0 - holtburgerRegionDetailSourceAlpha)",
		);
		expect(shader.fragmentShader).toContain(
			"uniform int holtburgerRegionDetailBlendMode;",
		);
		expect(shader.uniforms).toMatchObject({
			holtburgerRegionDetailBlendMode: { value: 1 },
			holtburgerRegionDetailFadeMode: { value: 0 },
		});
	});
});

function createResolvedDetailOverlay(): ResolvedRegionDetailOverlay {
	return {
		regionNumber: 1,
		profileAssetId: "region-render-profile/1",
		role: {
			role: "building",
			textureAssetId: "surface-texture/05001787",
			textureDid: 0x05001787,
			tiling: 8,
			fadeNear: 10,
			fadeFar: 50,
		},
		blendMode: "dst-color",
		fadeMode: "constant",
		texture: new Texture(),
		signature:
			"detail:1:building:surface-texture/05001787:8:10:50:dst-color:constant",
	};
}
