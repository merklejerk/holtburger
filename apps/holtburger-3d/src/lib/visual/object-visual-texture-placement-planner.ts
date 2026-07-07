import type {
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import type {
	DynamicTexturePlacementUse,
	ObjectVisualTexturePlacementIntent,
	TexturePlacementPolicy,
	TexturePlacementSource,
} from "../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TextureOwnerId,
	TexturePageClass,
} from "../textures/identity";
import {
	createObjectVisualDynamicTexturePlacementIntent,
	createObjectVisualStaticTexturePlacementIntent,
	createTexturePlacementItemId,
} from "../textures/placement";

type ObjectVisualTexturePlacementPolicy =
	| ObjectVisualStaticTexturePlacementPolicy
	| ObjectVisualDynamicTexturePlacementPolicy;

interface ObjectVisualStaticTexturePlacementPolicy {
	readonly affinityKey: string | null;
	readonly domain: StaticBakeTextureUse["domain"];
	readonly kind: "static-authored";
	readonly placementPolicy?: TexturePlacementPolicy;
}

interface ObjectVisualDynamicTexturePlacementPolicy {
	readonly affinityKey: string | null;
	readonly kind: "dynamic";
	readonly placementPolicy: TexturePlacementPolicy;
	readonly textureDomain: VisualTextureDomain;
}

export interface ObjectVisualTexturePlacementRequirement {
	readonly policy: ObjectVisualTexturePlacementPolicy;
	readonly requirement: ObjectVisualTextureSourceRequirement;
}

interface ObjectVisualTextureSourceRequirement {
	readonly bindingId: TextureBindingId;
	readonly ownerIds: readonly TextureOwnerId[];
	readonly pageClass: TexturePageClass;
	readonly samplingPolicy?: StaticBakeTextureUse["samplingPolicy"];
	readonly source: TexturePlacementSource;
	readonly textureKey: TextureKey;
}

export function createObjectVisualTexturePlacementIntents(input: {
	readonly requirements: readonly ObjectVisualTexturePlacementRequirement[];
}): readonly ObjectVisualTexturePlacementIntent[] {
	const intentsByBindingId = new Map<
		TextureBindingId,
		ObjectVisualTexturePlacementIntent
	>();

	for (const item of input.requirements) {
		if (intentsByBindingId.has(item.requirement.bindingId)) {
			continue;
		}
		const itemId = createTexturePlacementItemId(intentsByBindingId.size);
		intentsByBindingId.set(
			item.requirement.bindingId,
			createObjectVisualTexturePlacementIntent(item, itemId),
		);
	}

	return [...intentsByBindingId.values()].sort(
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
					bindingId: item.requirement.bindingId,
					ownerIds: item.requirement.ownerIds,
					pageClass: item.requirement.pageClass,
					placementPolicy: item.policy.placementPolicy,
					textureKey: item.requirement.textureKey,
				},
			);
		case "dynamic":
			return createObjectVisualDynamicTexturePlacementIntent(
				createDynamicObjectVisualTextureUse(item.requirement, item.policy),
				itemId,
				{
					affinityKey: item.policy.affinityKey,
					bindingId: item.requirement.bindingId,
					ownerIds: item.requirement.ownerIds,
					pageClass: item.requirement.pageClass,
					placementPolicy: item.policy.placementPolicy,
					textureKey: item.requirement.textureKey,
				},
			);
	}
}

function createStaticObjectVisualTextureUse(
	requirement: ObjectVisualTextureSourceRequirement,
	policy: ObjectVisualStaticTexturePlacementPolicy,
): StaticBakeTextureUse {
	const textureUse: StaticBakeTextureUse = {
		bindingId: requirement.bindingId,
		domain: policy.domain,
		ownerIds: requirement.ownerIds,
		owners: [],
		pageClass: requirement.pageClass,
		source: requirement.source.dataUse,
		textureKey: requirement.textureKey,
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
		bindingId: requirement.bindingId,
		ownerIds: requirement.ownerIds,
		pageClass: requirement.pageClass,
		source: requirement.source.dataUse,
		textureKey: requirement.textureKey,
		textureDomain: policy.textureDomain,
	};
	if (!requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: requirement.samplingPolicy,
	};
}
