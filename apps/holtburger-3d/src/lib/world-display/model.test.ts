import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import { createInitialAssetChannelState } from "../assets/types";
import { deriveBrowserWorldDisplayModel } from "./model";

describe("browser world display model", () => {
	it("derives browser status from destination-owned state", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		const model = deriveBrowserWorldDisplayModel({
			assetState: createInitialAssetChannelState(),
			browserDestination: destination,
			terrainLodRadius: 1,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			cameraAck: null,
			pendingCameraHint: false,
		});

		expect(model.destinationFocusLabel).toBe(destination?.label);
		expect(model.sceneContext.kind).toBe("outdoor-landblock-ring");
		expect(collectModelText(model)).not.toMatch(
			/\bruntime\b|\bauthoritative\b|host\/player/i,
		);
	});

	it("describes dungeon destination coverage as direct env-cell assets", () => {
		const destination = parseBrowserLocationInput("016c0155");
		const model = deriveBrowserWorldDisplayModel({
			assetState: createInitialAssetChannelState(),
			browserDestination: destination,
			terrainLodRadius: 1,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			cameraAck: null,
			pendingCameraHint: false,
		});

		expect(model.sceneContext.kind).toBe("indoor-env-cell-closure");
		expect(model.sceneContext.coverageText).toContain(
			"Browser dungeons load topology membership and direct env-cell render assets.",
		);
		expect(collectModelText(model)).not.toMatch(
			/\bruntime\b|\bauthoritative\b|visible-cell/i,
		);
	});
});

function collectModelText(
	model: ReturnType<typeof deriveBrowserWorldDisplayModel>,
): string {
	return [
		model.headline,
		model.destinationFocusLabel,
		model.destinationLabel,
		model.renderCacheText,
		model.inputText,
		model.assetText,
		model.sceneContext.statusText,
		model.sceneContext.destinationText,
		model.sceneContext.coverageText,
		model.sceneContext.gapText,
		model.terrainContract.indoorBranchText,
		model.terrainContract.statusText,
	].join("\n");
}
