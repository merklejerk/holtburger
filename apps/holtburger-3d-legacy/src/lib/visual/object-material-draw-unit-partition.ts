import type {
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacementItemId,
	TextureUsagePurpose,
} from "../textures/placement";

export interface ObjectMaterialRenderablePrimitive {
	readonly materialEntryKey: string;
	readonly textureRequirements: readonly ObjectMaterialTextureRequirement[];
}

export interface ObjectMaterialDrawUnitPartitionKey {
	readonly key: string;
	readonly material: ObjectMaterialPartitionAxis;
	readonly textureBindingTuple: ObjectMaterialTextureBindingTuple;
}

export interface ObjectMaterialPartitionAxis {
	readonly key: string;
	readonly family: ObjectMaterialFamily;
	readonly renderCoverage: string | null;
	readonly pass: ObjectMaterialPass;
	readonly alphaMode: string;
	readonly blendMode: string;
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: "clamp" | "repeat";
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
	/** Shader-visible texture binding tuple; packer-local page ids are diagnostic only. */
	readonly textureBindingTupleKey: string;
}

type ObjectMaterialFamily =
	"flat-color" | "indexed-paletted" | "texture-rgba" | "unsupported";

type ObjectMaterialPass = "additive" | "alpha-test" | "opaque" | "transparent";

export interface ObjectMaterialPartitionInput {
	readonly alphaMode: string;
	readonly blendMode: string;
	readonly family: ObjectMaterialFamily;
	readonly materialColorKey: string;
	readonly materialEntryKey: string;
	readonly pass: ObjectMaterialPass;
	/** Static-only coverage classification; dynamic visuals should usually leave it null. */
	readonly renderCoverage: string | null;
	readonly textureRoleLayoutKey: string;
	readonly textureRoleSchemaKey: string;
	readonly textureWrapMode: "clamp" | "repeat";
}

export interface ObjectMaterialTextureRequirement {
	readonly placementItemId: TexturePlacementItemId;
	readonly purpose: TextureUsagePurpose;
}

export type ObjectMaterialTexturePlacementReadiness =
	| {
			readonly kind: "pending";
	  }
	| {
			readonly kind: "failed";
			readonly reason: string;
	  };

interface ObjectMaterialTextureBindingTuple {
	readonly key: string;
	readonly bindings: readonly ObjectMaterialTextureBindingTupleEntry[];
}

interface ObjectMaterialTextureBindingTupleEntry {
	readonly purpose: Extract<
		TextureUsagePurpose,
		"object-base-color" | "object-detail" | "object-index" | "object-palette"
	>;
	readonly textureRefId: string;
}

export function createObjectMaterialDrawUnitPartitionKey(options: {
	readonly diagnosticSubject?: string;
	readonly includeConcreteEntryInKey: boolean;
	readonly material: ObjectMaterialPartitionInput;
	readonly texturePlacementSnapshot:
		ObjectVisualTexturePlacementSnapshot | undefined;
	readonly texturePlacementReadinessByItemId?: ReadonlyMap<
		TexturePlacementItemId,
		ObjectMaterialTexturePlacementReadiness
	>;
	readonly textureRequirements: readonly ObjectMaterialTextureRequirement[];
}): ObjectMaterialDrawUnitPartitionKey {
	const textureBindingTuple = createObjectMaterialTextureBindingTuple({
		diagnosticSubject: options.diagnosticSubject,
		placementSnapshot: options.texturePlacementSnapshot,
		readinessByItemId: options.texturePlacementReadinessByItemId,
		requirements: options.textureRequirements,
	});
	const material = createObjectMaterialPartitionAxis({
		includeConcreteEntryInKey: options.includeConcreteEntryInKey,
		material: options.material,
		textureBindingTupleKey: textureBindingTuple.key,
	});

	return {
		key: material.key,
		material,
		textureBindingTuple,
	};
}

export function splitObjectMaterialPartitionByMaterialTableBudget<
	TPrimitive extends ObjectMaterialRenderablePrimitive,
>(options: {
	readonly maxMaterialEntriesPerPartition: number;
	readonly primitives: readonly TPrimitive[];
}): readonly (readonly TPrimitive[])[] {
	const splits: TPrimitive[][] = [];
	let current: TPrimitive[] = [];
	let currentMaterialEntryKeys = new Set<string>();

	for (const primitive of options.primitives) {
		if (
			current.length > 0 &&
			!currentMaterialEntryKeys.has(primitive.materialEntryKey) &&
			currentMaterialEntryKeys.size >= options.maxMaterialEntriesPerPartition
		) {
			splits.push(current);
			current = [];
			currentMaterialEntryKeys = new Set<string>();
		}

		current.push(primitive);
		currentMaterialEntryKeys.add(primitive.materialEntryKey);
	}

	if (current.length > 0) {
		splits.push(current);
	}

	return splits;
}

function createObjectMaterialPartitionAxis(options: {
	readonly includeConcreteEntryInKey: boolean;
	readonly material: ObjectMaterialPartitionInput;
	readonly textureBindingTupleKey: string;
}): ObjectMaterialPartitionAxis {
	const key = [
		`family:${options.material.family}`,
		`coverage:${options.material.renderCoverage ?? "none"}`,
		`pass:${options.material.pass}`,
		`alpha:${options.material.alphaMode}`,
		`blend:${options.material.blendMode}`,
		`wrap:${options.material.textureWrapMode}`,
		`textures:${options.textureBindingTupleKey}`,
		options.includeConcreteEntryInKey
			? `entry:${options.material.materialEntryKey}`
			: `schema:${options.material.textureRoleSchemaKey}`,
	].join("|");

	return {
		alphaMode: options.material.alphaMode,
		blendMode: options.material.blendMode,
		family: options.material.family,
		key,
		materialColorKey: options.material.materialColorKey,
		materialEntryKey: options.material.materialEntryKey,
		pass: options.material.pass,
		renderCoverage: options.material.renderCoverage,
		textureBindingTupleKey: options.textureBindingTupleKey,
		textureRoleLayoutKey: options.material.textureRoleLayoutKey,
		textureRoleSchemaKey: options.material.textureRoleSchemaKey,
		textureWrapMode: options.material.textureWrapMode,
	};
}

function createObjectMaterialTextureBindingTuple(options: {
	readonly diagnosticSubject?: string;
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot | undefined;
	readonly readinessByItemId:
		| ReadonlyMap<
				TexturePlacementItemId,
				ObjectMaterialTexturePlacementReadiness
		  >
		| undefined;
	readonly requirements: readonly ObjectMaterialTextureRequirement[];
}): ObjectMaterialTextureBindingTuple {
	if (!options.placementSnapshot) {
		const purposes = [
			...new Set(
				options.requirements.map((requirement) =>
					requireObjectMaterialTexturePurpose(requirement.purpose),
				),
			),
		].sort();
		const bindings = purposes.map((purpose) => ({
			purpose,
			textureRefId: "unplaced",
		}));
		return {
			bindings,
			key:
				bindings.length === 0
					? "none"
					: bindings
							.map((entry) => `${entry.purpose}:${entry.textureRefId}`)
							.join("|"),
		};
	}

	const placementSnapshot = options.placementSnapshot;
	const entries = options.requirements.map((requirement) => {
		const purpose = requireObjectMaterialTexturePurpose(requirement.purpose);
		const placement = placementSnapshot.placementsByItemId.get(
			requirement.placementItemId,
		);
		if (!placement) {
			const readiness = options.readinessByItemId?.get(
				requirement.placementItemId,
			);
			if (readiness?.kind === "pending") {
				return {
					purpose,
					textureRefId: "pending",
				};
			}
			const subject = options.diagnosticSubject ?? "Object-like material";
			if (readiness?.kind === "failed") {
				throw new Error(
					`${subject} texture placement ${requirement.placementItemId} failed: ${readiness.reason}.`,
				);
			}
			throw new Error(
				`${subject} texture placement snapshot is missing ${requirement.placementItemId}.`,
			);
		}
		if (placement.purpose !== purpose) {
			const subject = options.diagnosticSubject ?? "Object-like material";
			throw new Error(
				`${subject} texture placement ${requirement.placementItemId} has incompatible purpose ${placement.purpose}; expected ${purpose}.`,
			);
		}
		if (
			typeof placement.textureRefId !== "string" ||
			placement.textureRefId.length === 0
		) {
			const subject = options.diagnosticSubject ?? "Object-like material";
			throw new Error(
				`${subject} texture placement ${requirement.placementItemId} is missing textureRefId.`,
			);
		}
		return {
			purpose,
			textureRefId: placement.textureRefId,
		};
	});
	const sortedEntries = [...entries].sort(
		compareObjectMaterialTextureBindingEntries,
	);
	return {
		bindings: sortedEntries,
		key:
			sortedEntries.length === 0
				? "none"
				: sortedEntries
						.map((entry) => `${entry.purpose}:${entry.textureRefId}`)
						.join("|"),
	};
}

function requireObjectMaterialTexturePurpose(
	purpose: TextureUsagePurpose,
): ObjectMaterialTextureBindingTupleEntry["purpose"] {
	switch (purpose) {
		case "object-base-color":
		case "object-detail":
		case "object-index":
		case "object-palette":
			return purpose;
		case "terrain-color":
		case "terrain-detail":
		case "terrain-mask":
			throw new Error(
				`Object-like material partition received incompatible texture purpose ${purpose}.`,
			);
	}
}

function compareObjectMaterialTextureBindingEntries(
	left: ObjectMaterialTextureBindingTupleEntry,
	right: ObjectMaterialTextureBindingTupleEntry,
): number {
	return (
		left.purpose.localeCompare(right.purpose) ||
		left.textureRefId.localeCompare(right.textureRefId)
	);
}
