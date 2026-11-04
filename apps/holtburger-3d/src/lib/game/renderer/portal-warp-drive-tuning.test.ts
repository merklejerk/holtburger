import { describe, expect, it } from "vitest";

import { CLIENT_TUNING } from "../../../client/client-tuning";
import { EXPLORER_TUNING } from "../../../explorer/explorer-tuning";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	validatePortalWarpDriveTuning,
	type PortalWarpDriveTuning,
} from "./portal-warp-drive-tuning";

const PRODUCTION_TUNING = CLIENT_TUNING.portalTransition.visual;

describe("portal warp-drive tuning", () => {
	it.each([
		["client", CLIENT_TUNING.portalTransition.visual],
		["Explorer", EXPLORER_TUNING.portalTransition.visual],
	])("accepts the %s visual policy", (_name, tuning) => {
		expect(tuning).toBe(SHARED_FRONTEND_TUNING.portalTransition.visual);
		expect(() => validatePortalWarpDriveTuning(tuning)).not.toThrow();
	});

	it.each([
		["non-finite acceleration exponent", { accelerationExponent: Number.NaN }],
		["non-positive acceleration exponent", { accelerationExponent: 0 }],
		["non-finite maximum zoom", { maximumZoom: Number.NaN }],
		["sub-neutral maximum zoom", { maximumZoom: 0.99 }],
		["non-finite streak intensity", { streakIntensity: Number.NaN }],
		["negative streak intensity", { streakIntensity: -0.01 }],
		["non-finite world opacity exponent", { worldOpacityExponent: Number.NaN }],
		["non-positive world opacity exponent", { worldOpacityExponent: 0 }],
	])("rejects a %s", (_name, override) => {
		expect(() =>
			validatePortalWarpDriveTuning({
				...PRODUCTION_TUNING,
				...override,
			}),
		).toThrow();
	});

	it.each([
		["non-finite start", { startRadius: Number.NaN, fullRadius: 0.65 }],
		["negative start", { startRadius: -0.01, fullRadius: 0.65 }],
		["non-finite full radius", { startRadius: 0.08, fullRadius: Number.NaN }],
		["unordered bounds", { startRadius: 0.65, fullRadius: 0.65 }],
	])("rejects radial smear tuning with %s", (_name, radialSmear) => {
		const tuning: PortalWarpDriveTuning = {
			...PRODUCTION_TUNING,
			radialSmear,
		};
		expect(() => validatePortalWarpDriveTuning(tuning)).toThrow();
	});
});
