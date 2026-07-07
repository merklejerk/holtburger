import { describe, expect, it } from "vitest";
import { createDefaultBrowserSpawnFormState } from "./runtime-spawn-form";
import { placeBrowserSpawnFormInFrontOfCamera } from "./runtime-spawn-camera-placement";

describe("browser runtime spawn camera placement", () => {
	it("places outdoor spawns one meter in front of the current camera", () => {
		expect(
			placeBrowserSpawnFormInFrontOfCamera({
				camera: {
					pitchRadians: 0,
					position: [10, 2, -20],
					yawRadians: 0,
				},
				currentCameraResidency: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				form: createDefaultBrowserSpawnFormState(),
				sceneInterest: {
					anchorLandblockId: 0xda55ffff,
					domains: ["terrain"],
					kind: "outdoor-anchor",
					source: "manual",
				},
			}),
		).toMatchObject({
			landblockId: "0xda55ffff",
			originX: "10",
			originY: "21",
			originZ: "2",
			residenceMode: "outdoor",
			yawDegrees: "0",
		});
	});

	it("rebases outdoor camera-relative placement across landblock boundaries", () => {
		expect(
			placeBrowserSpawnFormInFrontOfCamera({
				camera: {
					pitchRadians: 0,
					position: [10, 2, -191.5],
					yawRadians: 0,
				},
				currentCameraResidency: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				form: createDefaultBrowserSpawnFormState(),
				sceneInterest: {
					anchorLandblockId: 0xda55ffff,
					domains: ["terrain"],
					kind: "outdoor-anchor",
					source: "manual",
				},
			}),
		).toMatchObject({
			landblockId: "0xda56ffff",
			originX: "10",
			originY: "0.5",
			originZ: "2",
			residenceMode: "outdoor",
		});
	});

	it("uses current env-cell residence for interior camera-relative spawns", () => {
		expect(
			placeBrowserSpawnFormInFrontOfCamera({
				camera: {
					pitchRadians: 0,
					position: [5, 6, 7],
					yawRadians: Math.PI / 2,
				},
				currentCameraResidency: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
				form: createDefaultBrowserSpawnFormState(),
				sceneInterest: {
					envCellId: 0xda550100,
					kind: "interior-cell",
					landblockId: 0xda55ffff,
					source: "manual",
				},
			}),
		).toMatchObject({
			envCellId: "0xda550100",
			landblockId: "0xda55ffff",
			originX: "6",
			originY: "-7",
			originZ: "6",
			residenceMode: "env-cell",
			yawDegrees: "90",
		});
	});

	it("writes placement origin fields that runtime matrices convert back to the camera-forward render point", () => {
		const placed = placeBrowserSpawnFormInFrontOfCamera({
			camera: {
				pitchRadians: 0,
				position: [10, 2, -20],
				yawRadians: 0,
			},
			currentCameraResidency: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			form: createDefaultBrowserSpawnFormState(),
			sceneInterest: {
				anchorLandblockId: 0xda55ffff,
				domains: ["terrain"],
				kind: "outdoor-anchor",
				source: "manual",
			},
		});

		expect(placed).not.toBeNull();
		expect(placementOriginToRenderPoint(placed ?? failForm())).toEqual([
			10, 2, -21,
		]);
	});

	it("rejects camera-relative placement without a usable residence", () => {
		expect(
			placeBrowserSpawnFormInFrontOfCamera({
				camera: {
					pitchRadians: 0,
					position: [0, 0, 0],
					yawRadians: 0,
				},
				currentCameraResidency: {
					kind: "unknown",
					landblockId: null,
				},
				form: createDefaultBrowserSpawnFormState(),
				sceneInterest: { kind: "none" },
			}),
		).toBeNull();
	});
});

function placementOriginToRenderPoint(form: {
	readonly originX: string;
	readonly originY: string;
	readonly originZ: string;
}): readonly [number, number, number] {
	return [Number(form.originX), Number(form.originZ), -Number(form.originY)];
}

function failForm(): never {
	throw new Error("expected placed form");
}
