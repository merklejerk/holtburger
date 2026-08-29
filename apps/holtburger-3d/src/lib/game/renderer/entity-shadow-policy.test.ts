import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { AABB3, Mat4, Vec3 } from "../math/types";
import {
	DEFAULT_ENTITY_SHADOW_SETTINGS,
	MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER,
	MAX_OUTDOOR_PSSM_CASCADES,
	MAX_OUTDOOR_PSSM_MAP_RESOLUTION,
	createEntityShadowSettings,
	createEntityGroundingSettings,
	createOutdoorPssmSettings,
	isEntityShadowCasterCategory,
	isOutdoorPssmReceiverFootprint,
} from "./entity-shadow-policy";

describe("entity shadow policy", () => {
	it("publishes a complete default-hybrid policy within fixed shader ceilings", () => {
		expect(DEFAULT_ENTITY_SHADOW_SETTINGS.mode).toBe("shadow-maps");
		expect(
			DEFAULT_ENTITY_SHADOW_SETTINGS.pssm.cascadeCount,
		).toBeLessThanOrEqual(MAX_OUTDOOR_PSSM_CASCADES);
		expect(
			DEFAULT_ENTITY_SHADOW_SETTINGS.pssm.mapResolution,
		).toBeLessThanOrEqual(MAX_OUTDOOR_PSSM_MAP_RESOLUTION);
		expect(MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER).toBe(
			FRONTEND_TUNING.rendering.entityShadows
				.maximumGroundingCastersPerReceiver,
		);
	});

	it.each(["none", "simple", "shadow-maps"] as const)(
		"retains complete tuning in %s mode",
		(mode) => {
			const settings = createEntityShadowSettings({
				...DEFAULT_ENTITY_SHADOW_SETTINGS,
				mode,
			});
			expect(settings.mode).toBe(mode);
			expect(settings.pssm).toBe(DEFAULT_ENTITY_SHADOW_SETTINGS.pssm);
			expect(settings.grounding).toBe(DEFAULT_ENTITY_SHADOW_SETTINGS.grounding);
		},
	);

	it("admits only the three producer-resolved actor categories", () => {
		expect(
			(["player", "npc", "mob", "other"] as const).map(
				isEntityShadowCasterCategory,
			),
		).toEqual([true, true, true, false]);
	});

	it("admits only authored buildings as outdoor object receivers", () => {
		const localBounds = new AABB3(Vec3.zero(), new Vec3(1, 1, 1));
		const placement = {
			envCellId: null,
			landblockId: "0x0101ffff",
			localToLandblock: Mat4.identity(),
			scope: { kind: "outdoor" as const },
		};
		expect(
			(
				[
					"building",
					"explicit-object",
					"env-cell-resident",
					"authored-dynamic",
				] as const
			).map((objectClass) =>
				isOutdoorPssmReceiverFootprint({
					kind: "eligible",
					objectClass,
					localBounds,
					placement,
				}),
			),
		).toEqual([true, false, false, false]);
		expect(
			isOutdoorPssmReceiverFootprint({
				kind: "ineligible",
				reason: "generated-instance-container",
			}),
		).toBe(false);
	});

	it.each([
		["cascade count", { cascadeCount: 0 }, "cascade count"],
		["map resolution", { mapResolution: 300 }, "map resolution"],
		["maximum distance", { maximumDistance: Number.NaN }, "maximum distance"],
		[
			"minimum light elevation",
			{ minimumLightElevationDegrees: 91 },
			"minimum light elevation",
		],
		["split lambda", { splitLambda: 1.1 }, "split lambda"],
		[
			"transition fraction",
			{ transitionFraction: -0.1 },
			"transition fraction",
		],
		[
			"receiver depth bias",
			{ receiverDepthBias: 0.051 },
			"receiver depth bias",
		],
		[
			"normal-offset bias",
			{ normalOffsetBias: Number.POSITIVE_INFINITY },
			"normal-offset bias",
		],
		[
			"polygon factor",
			{ casterPolygonOffsetFactor: -1 },
			"polygon-offset factor",
		],
		["polygon units", { casterPolygonOffsetUnits: 17 }, "polygon-offset units"],
		["PCF radius", { pcfRadius: 0.5 }, "PCF radius"],
		["strength", { strength: -0.1 }, "strength"],
		["caster padding", { casterSearchPadding: 513 }, "caster-search padding"],
	] as const)("rejects an invalid outdoor %s", (_label, override, message) => {
		expect(() =>
			createOutdoorPssmSettings({
				...DEFAULT_ENTITY_SHADOW_SETTINGS.pssm,
				...override,
			}),
		).toThrow(message);
	});

	it.each([
		["strength", { strength: Number.NaN }, "strength"],
		["radius scale", { radiusScale: 0 }, "radius scale"],
		["softness", { softness: 0 }, "softness"],
		["drop spread", { dropSpread: 2.1 }, "drop spread"],
		["maximum drop", { maximumDrop: -1 }, "maximum drop"],
		["minimum up-facing", { minimumUpFacing: 1.1 }, "minimum up-facing"],
		["full up-facing", { fullStrengthUpFacing: 0 }, "full-strength up-facing"],
		[
			"threshold order",
			{ minimumUpFacing: 0.8, fullStrengthUpFacing: 0.8 },
			"strictly ordered",
		],
		["contact bias", { contactBias: Number.POSITIVE_INFINITY }, "contact bias"],
	] as const)(
		"rejects an invalid grounding %s",
		(_label, override, message) => {
			expect(() =>
				createEntityGroundingSettings({
					...DEFAULT_ENTITY_SHADOW_SETTINGS.grounding,
					...override,
				}),
			).toThrow(message);
		},
	);

	it("rejects an unknown mode before nested consumers", () => {
		expect(() =>
			createEntityShadowSettings({
				...DEFAULT_ENTITY_SHADOW_SETTINGS,
				mode: "cinematic" as never,
			}),
		).toThrow("mode must be none, simple, or shadow-maps");
	});
});
