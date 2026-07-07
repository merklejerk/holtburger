import type {
	ObjectVisualTexturePlacementIntent,
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacement,
	TexturePlacementItemId,
} from "../../../../textures/placement";
import { createTexturePlacementItemId } from "../../../../textures/placement";
import type { TextureBindingId } from "../../../../textures/identity";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import type { OpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-builder";
import { buildMaterialTexturePlacementPlan } from "./material-texture-placement-plan";

export interface OpenWorldObjectVisualTexturePlacementPlanOptions {
	readonly atlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly filteringMode: "nearest" | "linear" | "anisotropic-4x";
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly ownerId: MaterializationOwnerId;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldObjectVisualTexturePlacementPlan {
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
}

export async function buildObjectVisualTexturePlacementPlan(
	options: OpenWorldObjectVisualTexturePlacementPlanOptions,
): Promise<OpenWorldObjectVisualTexturePlacementPlan> {
	const intents = createBakeLocalObjectVisualIntents(options.intents);
	const materialPlan = await buildMaterialTexturePlacementPlan<
		TexturePlacementItemId,
		ObjectVisualTexturePlacementIntent
	>({
		atlasBuilder: options.atlasBuilder,
		filteringMode: options.filteringMode,
		intents,
		jobPrefix: "open-world-object-visual",
		ownerId: options.ownerId,
		textureClaims: options.textureClaims,
	});
	const placementsByItemId = new Map<
		TexturePlacementItemId,
		TexturePlacement<TexturePlacementItemId>
	>();
	const itemIdsByBindingId = new Map<
		TextureBindingId,
		TexturePlacementItemId
	>();
	const placementsByBindingId = new Map<
		TextureBindingId,
		{
			readonly bindingId: TextureBindingId;
			readonly placement: TexturePlacement<TexturePlacementItemId>;
		}
	>();

	for (const binding of materialPlan.bindingPlacements) {
		itemIdsByBindingId.set(binding.bindingId, binding.placement.itemId);
		placementsByBindingId.set(binding.bindingId, binding);
		placementsByItemId.set(binding.placement.itemId, binding.placement);
	}

	return {
		placementSnapshot: {
			itemIdsByBindingId,
			placementsByBindingId,
			placementsByItemId,
		},
		stageTimings: materialPlan.stageTimings,
		textureCommits: materialPlan.textureCommits,
	};
}

function createBakeLocalObjectVisualIntents(
	intents: readonly ObjectVisualTexturePlacementIntent[],
): readonly ObjectVisualTexturePlacementIntent[] {
	return intents.map((intent, index) => ({
		...intent,
		itemId: createTexturePlacementItemId(index),
	}));
}
