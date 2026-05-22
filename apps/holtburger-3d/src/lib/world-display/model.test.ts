import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import { createInitialAssetChannelState } from "../assets/types";
import {
	deriveBrowserWorldDisplayModel,
	describeRayPickResponse,
} from "./model";

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
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.destinationFocusLabel).toBe(destination?.label);
		expect(model.sceneContext.kind).toBe("outdoor-landblock-ring");
		expect(collectModelText(model)).not.toMatch(
			/\bruntime\b|\bauthoritative\b|host\/player/i,
		);
	});

	it("describes dungeon destination coverage as an owning landblock pack", () => {
		const destination = parseBrowserLocationInput("016c0155");
		const model = deriveBrowserWorldDisplayModel({
			assetState: createInitialAssetChannelState(),
			browserDestination: destination,
			terrainLodRadius: 1,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.sceneContext.kind).toBe("indoor-landblock-pack");
		expect(model.sceneContext.coverageText).toContain(
			"Browser dungeons load the owning landblock pack as an isolated scene.",
		);
		expect(collectModelText(model)).not.toMatch(
			/\bruntime\b|\bauthoritative\b|visible-cell/i,
		);
	});

	it("describes ray-pick diagnostics without authority language", () => {
		expect(
			describeRayPickResponse({
				requestId: "pick-1",
				resolved: false,
				hit: null,
			}),
		).toBe("No browser debug entity intersected the current pick ray.");
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
