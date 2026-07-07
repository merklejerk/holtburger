import type {
	ObjectVisualTexturePlacementIntent,
	TexturePlacementIntent,
	TexturePlacementLookupId,
} from "../../../textures/placement";
import type { TextureBindingId } from "../../../textures/identity";
import {
	createRuntimeTextureSamplerPolicy,
	type TextureFilteringMode,
} from "../../../textures/sampling-policy";
import type { SamplerPolicyUpdate } from "../../../renderer/types";
import type { MaterializationOwnerId } from "../owners/owner-id";
import type {
	OpenWorldMaterialTextureAtlasBuilder,
	OpenWorldObjectVisualAtlasBuilder,
} from "./atlas-build/object-visual-atlas-builder";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTextureBindingResidencyIssue,
} from "./claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "./commits/contracts";
import type { OpenWorldMaterialTexturePlacementReservation } from "./placement/material-texture-placement-plan";
import { reserveMaterialTexturePlacements } from "./placement/material-texture-placement-plan";
import type { OpenWorldObjectVisualTexturePlacementReservation } from "./placement/object-visual-texture-placement-plan";
import { reserveObjectVisualTexturePlacements } from "./placement/object-visual-texture-placement-plan";

export interface OpenWorldTextureResidencyServiceOptions {
	readonly applySamplerPolicyUpdate: (update: SamplerPolicyUpdate) => void;
	readonly applyTextureCommits: (
		commits: readonly OpenWorldStreamingTextureCommit[],
		revision: number,
	) => void;
	readonly objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly textureAtlasBuilder: OpenWorldMaterialTextureAtlasBuilder;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

/**
 * Single texture-residency workflow for static layers and dynamic visuals.
 * Callers may differ in source resolution and baking, but all renderer-facing
 * binding commits from placement reservation are applied here.
 */
export class OpenWorldTextureResidencyService {
	readonly #applyTextureCommits: (
		commits: readonly OpenWorldStreamingTextureCommit[],
		revision: number,
	) => void;
	readonly #applySamplerPolicyUpdate: (update: SamplerPolicyUpdate) => void;
	readonly #objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly #textureAtlasBuilder: OpenWorldMaterialTextureAtlasBuilder;
	readonly #textureClaims: OpenWorldTextureClaimRegistry;

	constructor(options: OpenWorldTextureResidencyServiceOptions) {
		this.#applySamplerPolicyUpdate = options.applySamplerPolicyUpdate;
		this.#applyTextureCommits = options.applyTextureCommits;
		this.#objectVisualAtlasBuilder = options.objectVisualAtlasBuilder;
		this.#textureAtlasBuilder = options.textureAtlasBuilder;
		this.#textureClaims = options.textureClaims;
	}

	releaseOwner(ownerId: MaterializationOwnerId): void {
		this.#textureClaims.releaseTextureOwner(ownerId);
	}

	createBindingResidencyIssues(
		bindingIds: readonly TextureBindingId[],
	): readonly OpenWorldTextureBindingResidencyIssue[] {
		return this.#textureClaims.createBindingResidencyIssues(bindingIds);
	}

	applyResidentSamplerPolicy(options: {
		readonly filteringMode: TextureFilteringMode;
		readonly revision: number;
	}): void {
		const policies = this.#textureClaims
			.createBucketSnapshots()
			.flatMap((bucket) => bucket.pages)
			.filter((page) => page.state === "resident")
			.map((page) => {
				const samplerPolicy = createRuntimeTextureSamplerPolicy({
					filteringMode: options.filteringMode,
					sampleClass: page.sampleClass,
				});
				return {
					anisotropy: samplerPolicy.anisotropy,
					filteringMode: samplerPolicy.filteringMode,
					mipmapsGenerated: samplerPolicy.generateMipmaps,
					samplerPolicyKey: samplerPolicy.policyKey,
					textureRefId: page.textureRefId,
				};
			});
		if (policies.length === 0) {
			return;
		}
		this.#applySamplerPolicyUpdate({
			policies,
			revision: options.revision,
		});
	}

	async reserveMaterialPlacements<
		TItemId extends TexturePlacementLookupId,
		TIntent extends TexturePlacementIntent<TItemId>,
	>(options: {
		readonly filteringMode: TextureFilteringMode;
		readonly intents: readonly TIntent[];
		readonly isCurrent: () => boolean;
		readonly jobPrefix: string;
		readonly ownerId: MaterializationOwnerId;
		readonly revision: number;
	}): Promise<OpenWorldMaterialTexturePlacementReservation<TItemId>> {
		const reservation = await reserveMaterialTexturePlacements<
			TItemId,
			TIntent
		>({
			atlasBuilder: this.#textureAtlasBuilder,
			filteringMode: options.filteringMode,
			intents: options.intents,
			jobPrefix: options.jobPrefix,
			ownerId: options.ownerId,
			textureClaims: this.#textureClaims,
		});
		this.#applyCurrentTextureCommits({
			commits: reservation.textureCommits,
			isCurrent: options.isCurrent,
			revision: options.revision,
		});
		return reservation;
	}

	async reserveObjectVisualPlacements(options: {
		readonly filteringMode: TextureFilteringMode;
		readonly intents: readonly ObjectVisualTexturePlacementIntent[];
		readonly isCurrent: () => boolean;
		readonly ownerId: MaterializationOwnerId;
		readonly revision: number;
	}): Promise<OpenWorldObjectVisualTexturePlacementReservation> {
		const reservation = await reserveObjectVisualTexturePlacements({
			atlasBuilder: this.#objectVisualAtlasBuilder,
			filteringMode: options.filteringMode,
			intents: options.intents,
			ownerId: options.ownerId,
			textureClaims: this.#textureClaims,
		});
		this.#applyCurrentTextureCommits({
			commits: reservation.textureCommits,
			isCurrent: options.isCurrent,
			revision: options.revision,
		});
		return reservation;
	}

	#applyCurrentTextureCommits(options: {
		readonly commits: readonly OpenWorldStreamingTextureCommit[];
		readonly isCurrent: () => boolean;
		readonly revision: number;
	}): void {
		if (options.commits.length === 0 || !options.isCurrent()) {
			return;
		}
		this.#applyTextureCommits(options.commits, options.revision);
	}
}
