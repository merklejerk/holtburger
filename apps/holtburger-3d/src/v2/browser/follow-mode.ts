import type { V2ParsedLocationInput } from "./location-input";
import { createSceneInterestFromLocation } from "./location-input";
import type { ManualStaticDomain, RuntimeSceneInterest } from "../runtime/client-runtime";
import { deriveOutdoorCameraLandblockResidency } from "../runtime/static-placement";
import type { StaticLodRadii } from "../static/contracts";

type V2ParsedOutdoorLandblockInput = Extract<
	V2ParsedLocationInput,
	{ readonly kind: "outdoor-landblock" }
>;

export interface BrowserFollowModeRebaseInput {
	readonly cameraPosition: readonly [number, number, number];
	readonly domains: readonly ManualStaticDomain[];
	readonly enabled: boolean;
	readonly lod: Partial<StaticLodRadii>;
	readonly submittedLocation: V2ParsedLocationInput | null;
}

export interface BrowserFollowModeRebase {
	readonly cameraPosition: readonly [number, number, number];
	readonly sceneInterest: RuntimeSceneInterest;
	readonly submittedLocation: V2ParsedOutdoorLandblockInput;
}

export function resolveBrowserFollowModeRebase(
	input: BrowserFollowModeRebaseInput,
): BrowserFollowModeRebase | null {
	const { submittedLocation } = input;
	if (
		!input.enabled ||
		!submittedLocation ||
		submittedLocation.kind !== "outdoor-landblock"
	) {
		return null;
	}

	const residency = deriveOutdoorCameraLandblockResidency({
		anchorLandblockId: submittedLocation.landblockId,
		cameraPosition: input.cameraPosition,
	});
	if (!residency || residency.landblockId === submittedLocation.landblockId) {
		return null;
	}

	const nextLocation: V2ParsedOutdoorLandblockInput = {
		kind: "outdoor-landblock",
		label: `Outdoor landblock ${formatHexId(residency.landblockId)}`,
		landblockId: residency.landblockId,
	};

	return {
		cameraPosition: residency.localCameraPosition,
		sceneInterest: createSceneInterestFromLocation(
			nextLocation,
			input.domains,
			input.lod,
			"follow",
		),
		submittedLocation: nextLocation,
	};
}

function formatHexId(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
