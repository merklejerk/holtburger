import { describe, expect, it } from "vitest";

import type { PortalTransitionFrame } from "./renderer";
import { resolvePortalTransitionComposition } from "./portal-transition-composition";

const TUNNEL_SAMPLE = {
	animationFramePosition: 12.5,
	axialRollFramePosition: 40,
} as const;

describe("resolvePortalTransitionComposition", () => {
	it.each<{
		readonly expected: string;
		readonly frame: PortalTransitionFrame | undefined;
	}>([
		{ expected: "scene-only", frame: undefined },
		{
			expected: "scene-only",
			frame: {
				kind: "destination-only-awaiting-handoff",
				generation: 1,
			},
		},
		{
			expected: "tunnel-only",
			frame: { kind: "tunnel-only", generation: 1, tunnel: TUNNEL_SAMPLE },
		},
		{
			expected: "origin-to-tunnel",
			frame: {
				kind: "origin-to-tunnel",
				generation: 1,
				progress: 0.25,
				tunnel: TUNNEL_SAMPLE,
			},
		},
		{
			expected: "tunnel-to-destination",
			frame: {
				kind: "tunnel-to-destination",
				generation: 1,
				progress: 0.75,
				tunnel: TUNNEL_SAMPLE,
			},
		},
	])("maps a complete frame to $expected", ({ expected, frame }) => {
		expect(
			resolvePortalTransitionComposition(frame, {
				origin: "origin",
				tunnel: "tunnel",
			}).kind,
		).toBe(expected);
	});

	it("preserves required resources and visual scalars", () => {
		expect(
			resolvePortalTransitionComposition(
				{
					kind: "tunnel-to-destination",
					generation: 2,
					progress: 0.5,
					tunnel: TUNNEL_SAMPLE,
				},
				{ origin: null, tunnel: "tunnel" },
			),
		).toEqual({
			kind: "tunnel-to-destination",
			progress: 0.5,
			tunnel: "tunnel",
		});
	});

	it("fails once for each missing required resource", () => {
		expect(() =>
			resolvePortalTransitionComposition(
				{ kind: "tunnel-only", generation: 1, tunnel: TUNNEL_SAMPLE },
				{ origin: null, tunnel: null },
			),
		).toThrow("tunnel-only requires the authored tunnel target");
		expect(() =>
			resolvePortalTransitionComposition(
				{
					kind: "origin-to-tunnel",
					generation: 1,
					progress: 0.5,
					tunnel: TUNNEL_SAMPLE,
				},
				{ origin: null, tunnel: "tunnel" },
			),
		).toThrow("origin-to-tunnel requires a captured origin target");
	});
});
