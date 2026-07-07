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
import type { OpenWorldTexturePageBuildInput } from "../page-build/protocol";
import type { OpenWorldTexturePageBuilder } from "../page-build/worker-client";
import type { OpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-builder";
import {
	buildReservedMaterialTexturePages,
	reserveMaterialTexturePlacements,
} from "./material-texture-placement-plan";

export interface OpenWorldObjectVisualTexturePlacementPlanOptions {
	readonly atlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly filteringMode: "nearest" | "linear" | "anisotropic-4x";
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly ownerId: MaterializationOwnerId;
	readonly pageBuilder: OpenWorldTexturePageBuilder;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldObjectVisualTexturePlacementReservationOptions {
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

export interface OpenWorldObjectVisualTexturePlacementReservation {
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

export async function buildObjectVisualTexturePlacementPlan(
	options: OpenWorldObjectVisualTexturePlacementPlanOptions,
): Promise<OpenWorldObjectVisualTexturePlacementPlan> {
	const reservation = await reserveObjectVisualTexturePlacements(options);
	const pageBuild = await buildReservedMaterialTexturePages({
		pageBuilder: options.pageBuilder,
		pageBuildRequests: reservation.pageBuildRequests,
		textureClaims: options.textureClaims,
	});
	return {
		placementSnapshot: reservation.placementSnapshot,
		stageTimings: [...reservation.stageTimings, ...pageBuild.stageTimings],
		textureCommits: pageBuild.textureCommits,
	};
}

export async function reserveObjectVisualTexturePlacements(
	options: OpenWorldObjectVisualTexturePlacementReservationOptions,
): Promise<OpenWorldObjectVisualTexturePlacementReservation> {
	const intents = createBakeLocalObjectVisualIntents(options.intents);
	const reservation = await reserveMaterialTexturePlacements<
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
	return {
		pageBuildRequests: reservation.pageBuildRequests,
		placementSnapshot: createObjectVisualPlacementSnapshot(
			reservation.bindingPlacements,
		),
		stageTimings: reservation.stageTimings,
	};
}

function createObjectVisualPlacementSnapshot(
	bindingPlacements: readonly {
		readonly bindingId: TextureBindingId;
		readonly placement: TexturePlacement<TexturePlacementItemId>;
	}[],
): ObjectVisualTexturePlacementSnapshot {
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

	for (const binding of bindingPlacements) {
		itemIdsByBindingId.set(binding.bindingId, binding.placement.itemId);
		placementsByBindingId.set(binding.bindingId, binding);
		placementsByItemId.set(binding.placement.itemId, binding.placement);
	}

	return {
		itemIdsByBindingId,
		placementsByBindingId,
		placementsByItemId,
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
