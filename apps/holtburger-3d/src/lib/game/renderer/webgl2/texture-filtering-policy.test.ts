import { describe, expect, it } from "vitest";
import {
	TEXTURE_FILTERING_POLICIES,
	createTextureFilteringCapabilities,
	isTextureFilteringPolicy,
	resolveTextureFilteringPolicy,
	supportedTextureFilteringPolicies,
	textureFilteringAnisotropy,
	textureFilteringPolicyLabel,
	type TextureFilteringPolicy,
} from "./texture-filtering-policy";

describe("texture filtering policy", () => {
	it.each([
		["nearest", 1],
		["linear", 1],
		["anisotropic-2x", 2],
		["anisotropic-4x", 4],
		["anisotropic-8x", 8],
	] as const)("maps %s to %sx anisotropy", (policy, expected) => {
		expect(textureFilteringAnisotropy(policy)).toBe(expected);
	});

	it.each([
		[1, ["nearest", "linear"]],
		[2, ["nearest", "linear", "anisotropic-2x"]],
		[3, ["nearest", "linear", "anisotropic-2x"]],
		[4, ["nearest", "linear", "anisotropic-2x", "anisotropic-4x"]],
		[
			8,
			[
				"nearest",
				"linear",
				"anisotropic-2x",
				"anisotropic-4x",
				"anisotropic-8x",
			],
		],
		[
			16,
			[
				"nearest",
				"linear",
				"anisotropic-2x",
				"anisotropic-4x",
				"anisotropic-8x",
			],
		],
	] as const)("lists distinct modes for a %sx device", (maximum, expected) => {
		expect(
			supportedTextureFilteringPolicies(
				createTextureFilteringCapabilities(maximum),
			),
		).toEqual(expected);
	});

	it.each([
		[1, ["nearest", "linear", "linear", "linear", "linear"]],
		[
			2,
			[
				"nearest",
				"linear",
				"anisotropic-2x",
				"anisotropic-2x",
				"anisotropic-2x",
			],
		],
		[
			4,
			[
				"nearest",
				"linear",
				"anisotropic-2x",
				"anisotropic-4x",
				"anisotropic-4x",
			],
		],
		[8, TEXTURE_FILTERING_POLICIES],
	] as const)(
		"resolves every requested mode for a %sx device",
		(maximum, expected) => {
			const capabilities = createTextureFilteringCapabilities(maximum);
			expect(
				TEXTURE_FILTERING_POLICIES.map((requested) =>
					resolveTextureFilteringPolicy(requested, capabilities),
				),
			).toEqual(expected satisfies readonly TextureFilteringPolicy[]);
		},
	);

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects invalid hardware maximum %s",
		(maximum) => {
			expect(() => createTextureFilteringCapabilities(maximum)).toThrow(
				"Maximum texture anisotropy must be finite and at least one",
			);
		},
	);

	it("provides one label for every closed policy", () => {
		expect(TEXTURE_FILTERING_POLICIES.map(textureFilteringPolicyLabel)).toEqual(
			[
				"Nearest",
				"Linear",
				"Anisotropic 2x",
				"Anisotropic 4x",
				"Anisotropic 8x",
			],
		);
	});

	it("validates untrusted policy vocabulary", () => {
		expect(isTextureFilteringPolicy("anisotropic-8x")).toBe(true);
		expect(isTextureFilteringPolicy("anisotropic-16x")).toBe(false);
	});
});
