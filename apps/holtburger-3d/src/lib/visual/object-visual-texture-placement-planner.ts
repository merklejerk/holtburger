import type {
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import type {
	DynamicTexturePlacementUse,
	ObjectVisualTexturePlacementIntent,
	TexturePlacementBucketKey,
	TexturePlacementSource,
} from "../textures/placement";
import {
	createObjectVisualDynamicTexturePlacementIntent,
	createObjectVisualStaticTexturePlacementIntent,
	createTexturePlacementItemId,
} from "../textures/placement";

export type ObjectVisualTexturePlacementPolicy =
	| ObjectVisualStaticTexturePlacementPolicy
	| ObjectVisualDynamicTexturePlacementPolicy;

export interface ObjectVisualStaticTexturePlacementPolicy {
	readonly affinityKey: string | null;
	readonly domain: StaticBakeTextureUse["domain"];
	readonly kind: "static-authored";
	readonly placementBucketKey?: TexturePlacementBucketKey;
}

export interface ObjectVisualDynamicTexturePlacementPolicy {
	readonly affinityKey: string | null;
	readonly kind: "dynamic";
	readonly placementBucketKey: TexturePlacementBucketKey;
	readonly textureDomain: VisualTextureDomain;
}

export interface ObjectVisualTexturePlacementRequirement {
	readonly policy: ObjectVisualTexturePlacementPolicy;
	readonly requirement: ObjectVisualTextureSourceRequirement;
}

export interface ObjectVisualTextureSourceRequirement {
	readonly bindingKey: string;
	readonly samplingPolicy?: StaticBakeTextureUse["samplingPolicy"];
	readonly source: TexturePlacementSource;
	readonly textureUseId: string;
}

export function createObjectVisualTexturePlacementIntents(input: {
	readonly requirements: readonly ObjectVisualTexturePlacementRequirement[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const intentsByTextureUseId = new Map<
		string,
		ObjectVisualTexturePlacementIntent
	>();

	for (const item of input.requirements) {
		if (intentsByTextureUseId.has(item.requirement.textureUseId)) {
			continue;
		}
		const itemId = createTexturePlacementItemId(intentsByTextureUseId.size);
		intentsByTextureUseId.set(
			item.requirement.textureUseId,
			createObjectVisualTexturePlacementIntent(item, itemId),
		);
	}

	return [...intentsByTextureUseId.values()].sort(
		(left, right) => left.itemId - right.itemId,
	);
}

function createObjectVisualTexturePlacementIntent(
	item: ObjectVisualTexturePlacementRequirement,
	itemId: ReturnType<typeof createTexturePlacementItemId>,
): ObjectVisualTexturePlacementIntent {
	switch (item.policy.kind) {
		case "static-authored":
			return createObjectVisualStaticTexturePlacementIntent(
				createStaticObjectVisualTextureUse(item.requirement, item.policy),
				itemId,
				{
					affinityKey: item.policy.affinityKey,
					placementBucketKey: item.policy.placementBucketKey,
				},
			);
		case "dynamic":
			return createObjectVisualDynamicTexturePlacementIntent(
				createDynamicObjectVisualTextureUse(item.requirement, item.policy),
				itemId,
				{
					affinityKey: item.policy.affinityKey,
					placementBucketKey: item.policy.placementBucketKey,
				},
			);
	}
}

function createStaticObjectVisualTextureUse(
	requirement: ObjectVisualTextureSourceRequirement,
	policy: ObjectVisualStaticTexturePlacementPolicy,
): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		domain: policy.domain,
		owners: [],
		source: requirement.source.dataUse,
		textureUseId: requirement.bindingKey,
	};
	if (!requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: requirement.samplingPolicy,
	};
}

function createDynamicObjectVisualTextureUse(
	requirement: ObjectVisualTextureSourceRequirement,
	policy: ObjectVisualDynamicTexturePlacementPolicy,
): DynamicTexturePlacementUse {
	const textureUse: DynamicTexturePlacementUse = {
		source: requirement.source.dataUse,
		textureDomain: policy.textureDomain,
		textureUseId: requirement.textureUseId,
	};
	if (!requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: requirement.samplingPolicy,
	};
}
