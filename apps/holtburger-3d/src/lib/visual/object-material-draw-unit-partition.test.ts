import { describe, expect, it } from "vitest";
import type {
	TextureBindingRequirement,
	TexturePlacementSnapshot,
} from "../textures/placement";
import { createObjectMaterialDrawUnitPartitionKey } from "./object-material-draw-unit-partition";

describe("object-material draw-unit partition contracts", () => {
	it("groups primitives with identical hard render identity", () => {
		const first = createObjectMaterialDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			material: createMaterialInput({
				materialEntryKey: "entry-a",
			}),
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-a", "object-base-color", "texture-ref-a"],
			]),
			textureRequirements: [createRequirement("base-a", "object-base-color")],
		});
		const second = createObjectMaterialDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			material: createMaterialInput({
				materialEntryKey: "entry-b",
			}),
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-b", "object-base-color", "texture-ref-a"],
			]),
			textureRequirements: [createRequirement("base-b", "object-base-color")],
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
			material: createMaterialInput({
				materialEntryKey: "entry-a",
			}),
			textureRequirements: [createRequirement("base-a", "object-base-color")],
		};

		const first = createObjectMaterialDrawUnitPartitionKey({
			...shared,
			texturePlacementSnapshot: createPlacementSnapshot([
				["base-a", "object-base-color", "texture-ref-a"],
			]),
		});
		const second = createObjectMaterialDrawUnitPartitionKey({
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

		const rgba = createObjectMaterialDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			material: createMaterialInput({ family: "texture-rgba" }),
			texturePlacementSnapshot,
			textureRequirements,
		});
		const indexed = createObjectMaterialDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			material: createMaterialInput({ family: "indexed-paletted" }),
			texturePlacementSnapshot,
			textureRequirements,
		});

		expect(indexed.key).not.toBe(rgba.key);
	});

	it("accepts dynamic-shaped texture requirements without static material plans", () => {
		const key = createObjectMaterialDrawUnitPartitionKey({
			includeConcreteEntryInKey: false,
			material: createMaterialInput({
				materialEntryKey: "dynamic-entry-a",
				renderCoverage: null,
			}),
			texturePlacementSnapshot: createPlacementSnapshot([
				["dynamic-base-a", "object-base-color", "texture-ref-a"],
			]),
			textureRequirements: [
				{
					placementItemId: "dynamic-base-a",
					purpose: "object-base-color",
				},
			],
		});

		expect(key.textureBindingTuple.bindings).toEqual([
			{
				purpose: "object-base-color",
				textureRefId: "texture-ref-a",
			},
		]);
	});

	it("rejects placements with incompatible object-material purposes", () => {
		expect(() =>
			createObjectMaterialDrawUnitPartitionKey({
				includeConcreteEntryInKey: false,
				material: createMaterialInput(),
				texturePlacementSnapshot: createPlacementSnapshot([
					["base-a", "object-detail", "texture-ref-a"],
				]),
				textureRequirements: [createRequirement("base-a", "object-base-color")],
			}),
		).toThrow(
			"Object-like material texture placement base-a has incompatible purpose object-detail; expected object-base-color.",
		);
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

function createMaterialInput(
	options: Partial<
		Parameters<typeof createObjectMaterialDrawUnitPartitionKey>[0]["material"]
	> = {},
): Parameters<typeof createObjectMaterialDrawUnitPartitionKey>[0]["material"] {
	return {
		alphaMode: "opaque",
		blendMode: "opaque",
		family: "texture-rgba",
		materialColorKey: "white",
		materialEntryKey: "entry-a",
		pass: "opaque",
		renderCoverage: "classified-render-candidate",
		textureRoleLayoutKey: "base-color:layout",
		textureRoleSchemaKey: "base-color:schema",
		textureWrapMode: "clamp",
		...options,
	};
}
