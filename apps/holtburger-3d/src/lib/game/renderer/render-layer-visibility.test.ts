import { describe, expect, it } from "vitest";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { DEFAULT_FRAME_SETTINGS, type RenderLayerVisibility } from "./renderer";
import { renderCullingGroupFilter } from "./render-layer-visibility";

describe("render contribution layer visibility", () => {
	it("maps every materialized landblock contribution to its renderer switch", () => {
		const cullingGroupByLayer: Readonly<Record<LandblockLayerKind, string>> = {
			[LandblockLayerKind.Terrain]: "terrain",
			[LandblockLayerKind.Buildings]: "buildings",
			[LandblockLayerKind.Objects]: "objects",
			[LandblockLayerKind.Generated]: "generated",
			[LandblockLayerKind.EnvCells]: "env-cell-shell",
		};
		for (const hiddenLayer of Object.values(LandblockLayerKind)) {
			const isVisible = renderCullingGroupFilter(
				visibilityWithHiddenLayer(hiddenLayer),
			);
			for (const [layer, cullingGroup] of Object.entries(cullingGroupByLayer)) {
				expect(isVisible(cullingGroup)).toBe(layer !== hiddenLayer);
			}
		}
	});

	it("treats EnvCell residents as part of the EnvCell switch", () => {
		const isVisible = renderCullingGroupFilter(
			visibilityWithHiddenLayer(LandblockLayerKind.EnvCells),
		);
		expect(isVisible("env-cell-static-residents")).toBe(false);
	});

	it("leaves dynamic entities outside static layer visibility policy", () => {
		const allHidden: RenderLayerVisibility = {
			[LandblockLayerKind.Terrain]: false,
			[LandblockLayerKind.Buildings]: false,
			[LandblockLayerKind.Objects]: false,
			[LandblockLayerKind.Generated]: false,
			[LandblockLayerKind.EnvCells]: false,
		};
		expect(renderCullingGroupFilter(allHidden)("dynamic")).toBe(true);
	});
});

function visibilityWithHiddenLayer(
	hiddenLayer: LandblockLayerKind,
): RenderLayerVisibility {
	return { ...DEFAULT_FRAME_SETTINGS.layerVisibility, [hiddenLayer]: false };
}
