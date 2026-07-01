import { describe, expect, it } from "vitest";
import type {
	TextureBindingRequirement,
	TexturePlacementSnapshot,
} from "../../../textures/placement";
import { createObjectLikeDrawUnitPartitionKey } from "./object-like-draw-unit-partition";
import type { StaticMaterialPlan } from "./static-object-material-planner";

describe("object-like draw-unit partition contracts", () => {
	it("groups primitives with identical hard render identity", () => {
		const plan = createPlan();
		const first = createObjectLikeDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			materialColorKey: "white",
			materialEntryKey: "entry-a",
			plan,
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-a", "object-base-color", "texture-ref-a"],
			]),
			textureRequirements: [
				createRequirement("base-a", "object-base-color"),
			],
			textureRoleLayoutKey: "base-color:layout",
			textureRoleSchemaKey: "base-color:schema",
			textureWrapMode: "clamp",
		});
		const second = createObjectLikeDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			materialColorKey: "white",
			materialEntryKey: "entry-b",
			plan,
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-b", "object-base-color", "texture-ref-a"],
			]),
			textureRequirements: [
				createRequirement("base-b", "object-base-color"),
			],
			textureRoleLayoutKey: "base-color:layout",
			textureRoleSchemaKey: "base-color:schema",
			textureWrapMode: "clamp",
		});

		expect(second.key).toBe(first.key);
		expect(first.textureBindingTuple.bindings).toEqual([
			{
				purpose: "object-base-color",
				textureRefId: "texture-ref-a",
			},
		]);
	});

	it("splits primitives with different shader-visible texture bindings", () => {
		const shared = {
			includeConcreteEntryInKey: false,
			materialColorKey: "white",
			materialEntryKey: "entry-a",
			plan: createPlan(),
			textureRequirements: [
				createRequirement("base-a", "object-base-color"),
			],
			textureRoleLayoutKey: "base-color:layout",
			textureRoleSchemaKey: "base-color:schema",
			textureWrapMode: "clamp" as const,
		};

		const first = createObjectLikeDrawUnitPartitionKey({
			...shared,
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-a", "object-base-color", "texture-ref-a"],
			]),
		});
		const second = createObjectLikeDrawUnitPartitionKey({
			...shared,
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-a", "object-base-color", "texture-ref-b"],
			]),
		});

		expect(second.key).not.toBe(first.key);
		expect(second.material.textureBindingTupleKey).toBe(
			"object-base-color:texture-ref-b",
		);
	});

	it("splits primitives with different material families", () => {
		const texturePlacementSnapshot = createPlacementSnapshot([
			["base-a", "object-base-color", "texture-ref-a"],
		]);
		const textureRequirements = [
			createRequirement("base-a", "object-base-color"),
		];

		const rgba = createObjectLikeDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			materialColorKey: "white",
			materialEntryKey: "entry-a",
			plan: createPlan({ family: "texture-rgba" }),
			texturePlacementSnapshot,
			textureRequirements,
			textureRoleLayoutKey: "base-color:layout",
			textureRoleSchemaKey: "base-color:schema",
			textureWrapMode: "clamp",
		});
		const indexed = createObjectLikeDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			materialColorKey: "white",
			materialEntryKey: "entry-a",
			plan: createPlan({ family: "indexed-paletted" }),
			texturePlacementSnapshot,
			textureRequirements,
			textureRoleLayoutKey: "base-color:layout",
			textureRoleSchemaKey: "base-color:schema",
			textureWrapMode: "clamp",
		});

		expect(indexed.key).not.toBe(rgba.key);
	});
});

function createRequirement(
	placementItemId: string,
	purpose: TextureBindingRequirement["purpose"],
): TextureBindingRequirement {
	return {
		bindingKey: `binding:${placementItemId}`,
		placementItemId,
		purpose,
		samplingPolicy: undefined,
		source: {
			dataUse: {
				kind: "prepared-render-surface-texture-use",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
				},
				usage: "rgba-color",
			},
			kind: "material-texture-data-use",
		},
		sourceKey: `source:${placementItemId}`,
	};
}

function createPlacementSnapshot(
	placements: readonly (readonly [
		string,
		TextureBindingRequirement["purpose"],
		string,
	])[],
): TexturePlacementSnapshot {
	return {
		placementsByItemId: new Map(
			placements.map(([itemId, purpose, textureRefId]) => [
				itemId,
				{
					height: 16,
					itemId,
					pageId: `page:${textureRefId}`,
					pool: "static-authored-object" as const,
					purpose,
					rect: [0, 0, 16, 16] as const,
					textureRefId,
					width: 16,
				},
			]),
		),
	};
}

function createPlan(
	options: Partial<Pick<StaticMaterialPlan, "family">> = {},
): StaticMaterialPlan {
	return {
		alphaPolicy: {
			alphaTest: 0,
			indexedClipThreshold: -1,
			mode: "opaque",
		},
		blend: {
			dstFactor: null,
			mode: "opaque",
			srcFactor: null,
		},
		color: [1, 1, 1, 1],
		detailRole: null,
		diagnostics: [],
		emissiveColor: [0, 0, 0],
		family: options.family ?? "texture-rgba",
		indexedTextureFormat: null,
		material: {
			kind: "material-source",
			materialId: 0x08000010,
		},
		materialBucketKey: "bucket",
		materialUseKey: "material-use",
		paletteFirstIndex: 0,
		pass: "opaque",
		renderCoverage: "classified-render-candidate",
		textureRoles: [],
	};
}
