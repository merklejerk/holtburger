import type {
	TextureBindingRequirement,
	TexturePlacementSnapshot,
	TextureUsagePurpose,
} from "../../../textures/placement";
import type { StaticMaterialPlan } from "./static-object-material-planner";

export interface ObjectLikeRenderablePrimitive {
	readonly materialEntryKey: string;
	readonly textureRequirements: readonly TextureBindingRequirement[];
}

export interface ObjectLikeDrawUnitPartitionKey {
	readonly key: string;
	readonly material: ObjectLikeMaterialPartitionAxis;
	readonly textureBindingTuple: ObjectLikeTextureBindingTuple;
}

export interface ObjectLikeMaterialPartitionAxis {
	readonly key: string;
	readonly family: StaticMaterialPlan["family"];
	readonly renderCoverage: StaticMaterialPlan["renderCoverage"];
	readonly pass: StaticMaterialPlan["pass"];
	readonly alphaMode: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly blendMode: StaticMaterialPlan["blend"]["mode"];
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: "clamp" | "repeat";
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
	/** Shader-visible texture binding tuple; packer-local page ids are diagnostic only. */
	readonly textureBindingTupleKey: string;
}

interface ObjectLikeTextureBindingTuple {
	readonly key: string;
	readonly bindings: readonly ObjectLikeTextureBindingTupleEntry[];
}

interface ObjectLikeTextureBindingTupleEntry {
	readonly purpose: Extract<
		TextureUsagePurpose,
		"object-base-color" | "object-detail" | "object-index" | "object-palette"
	>;
	readonly textureRefId: string;
}

export function createObjectLikeDrawUnitPartitionKey(options: {
	readonly diagnosticSubject?: string;
	readonly includeConcreteEntryInKey: boolean;
	readonly materialColorKey: string;
	readonly materialEntryKey: string;
	readonly plan: StaticMaterialPlan;
	readonly texturePlacementSnapshot: TexturePlacementSnapshot | undefined;
	readonly textureRequirements: readonly TextureBindingRequirement[];
	readonly textureRoleLayoutKey: string;
	readonly textureRoleSchemaKey: string;
	readonly textureWrapMode: "clamp" | "repeat";
}): ObjectLikeDrawUnitPartitionKey {
	const textureBindingTuple = createObjectLikeTextureBindingTuple({
		diagnosticSubject: options.diagnosticSubject,
		placementSnapshot: options.texturePlacementSnapshot,
		requirements: options.textureRequirements,
	});
	const material = createObjectLikeMaterialPartitionAxis({
		...options,
		textureBindingTupleKey: textureBindingTuple.key,
	});

	return {
		key: material.key,
		material,
		textureBindingTuple,
	};
}

export function splitObjectLikePartitionByMaterialTableBudget<
	TPrimitive extends ObjectLikeRenderablePrimitive,
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

function createObjectLikeMaterialPartitionAxis(options: {
	readonly includeConcreteEntryInKey: boolean;
	readonly materialColorKey: string;
	readonly materialEntryKey: string;
	readonly plan: StaticMaterialPlan;
	readonly textureBindingTupleKey: string;
	readonly textureRoleLayoutKey: string;
	readonly textureRoleSchemaKey: string;
	readonly textureWrapMode: "clamp" | "repeat";
}): ObjectLikeMaterialPartitionAxis {
	const key = [
		`family:${options.plan.family}`,
		`coverage:${options.plan.renderCoverage}`,
		`pass:${options.plan.pass}`,
		`alpha:${options.plan.alphaPolicy.mode}`,
		`blend:${options.plan.blend.mode}`,
		`wrap:${options.textureWrapMode}`,
		`textures:${options.textureBindingTupleKey}`,
		options.includeConcreteEntryInKey
			? `entry:${options.materialEntryKey}`
			: `schema:${options.textureRoleSchemaKey}`,
	].join("|");

	return {
		alphaMode: options.plan.alphaPolicy.mode,
		blendMode: options.plan.blend.mode,
		family: options.plan.family,
		key,
		materialColorKey: options.materialColorKey,
		materialEntryKey: options.materialEntryKey,
		pass: options.plan.pass,
		renderCoverage: options.plan.renderCoverage,
		textureBindingTupleKey: options.textureBindingTupleKey,
		textureRoleLayoutKey: options.textureRoleLayoutKey,
		textureRoleSchemaKey: options.textureRoleSchemaKey,
		textureWrapMode: options.textureWrapMode,
	};
}

function createObjectLikeTextureBindingTuple(options: {
	readonly diagnosticSubject?: string;
	readonly placementSnapshot: TexturePlacementSnapshot | undefined;
	readonly requirements: readonly TextureBindingRequirement[];
}): ObjectLikeTextureBindingTuple {
	if (!options.placementSnapshot) {
		const purposes = [
			...new Set(
				options.requirements.map((requirement) =>
					requireObjectLikeTexturePurpose(requirement.purpose),
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
		const purpose = requireObjectLikeTexturePurpose(requirement.purpose);
		const placement = placementSnapshot.placementsByItemId.get(
			requirement.placementItemId,
		);
		if (!placement) {
			const subject = options.diagnosticSubject ?? "Object-like material";
			throw new Error(
				`${subject} texture placement snapshot is missing ${requirement.placementItemId}.`,
			);
		}
		return {
			purpose,
			textureRefId: placement.textureRefId,
		};
	});
	const sortedEntries = [...entries].sort(compareObjectLikeTextureBindingEntries);
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

function requireObjectLikeTexturePurpose(
	purpose: TextureUsagePurpose,
): ObjectLikeTextureBindingTupleEntry["purpose"] {
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

function compareObjectLikeTextureBindingEntries(
	left: ObjectLikeTextureBindingTupleEntry,
	right: ObjectLikeTextureBindingTupleEntry,
): number {
	return (
		left.purpose.localeCompare(right.purpose) ||
		left.textureRefId.localeCompare(right.textureRefId)
	);
}
