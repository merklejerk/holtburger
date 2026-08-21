import type { TextureBindingId } from "../../../../textures/identity";
import type { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import type { OpenWorldTexturePageBuildOutput } from "./protocol";

export type OpenWorldTexturePageBuildSettlement =
	| {
			/** Result matched the current reservation and produced a texture commit. */
			readonly kind: "accepted";
			readonly commit: OpenWorldStreamingTextureCommit | null;
	  }
	| {
			/** Result targeted an obsolete reservation and must not mutate renderer state. */
			readonly kind: "stale";
	  };

export function settleOpenWorldTexturePageBuildResult(
	registry: OpenWorldTextureClaimRegistry,
	result: OpenWorldTexturePageBuildOutput,
): OpenWorldTexturePageBuildSettlement {
	if (result.kind === "noop") {
		const accepted = registry.acceptPageBuildNoop(
			result.pageId,
			result.reservationToken,
		);
		return accepted === "accepted"
			? { commit: null, kind: "accepted" }
			: { kind: "stale" };
	}

	const accepted = registry.acceptPageBuild(
		result.pageId,
		result.reservationToken,
	);
	if (accepted === "stale") {
		return { kind: "stale" };
	}

	return {
		commit: createOpenWorldStreamingTextureCommitFromPageUpdate(
			registry,
			result,
		),
		kind: "accepted",
	};
}

function createOpenWorldStreamingTextureCommitFromPageUpdate(
	registry: OpenWorldTextureClaimRegistry,
	result: Extract<
		OpenWorldTexturePageBuildOutput,
		{ readonly kind: "page-update" }
	>,
): OpenWorldStreamingTextureCommit {
	const bindingUpdates = registry
		.createResidentBindingPlacementsForPage({
			pageId: result.pageId,
			textureHeight: result.page.height,
			textureRefId: result.page.textureRefId,
			textureWidth: result.page.width,
		})
		.map((placement) =>
			createResidentBindingResolution({
				bindingId: placement.bindingId,
				rect: placement.rect,
				textureHeight: placement.textureHeight,
				textureRefId: placement.textureRefId,
				textureWidth: placement.textureWidth,
			}),
		);
	return {
		bindingRemovals: [],
		bindingUpdates,
		bucketKey: result.bucketKey,
		kind: "texture-commit",
		pageRemovals: [],
		pageUpdates: [
			{
				...result.page,
				pageId: result.pageId,
				reservationToken: result.reservationToken,
				uploadBindingId: requireUploadBindingId(result.placements),
			},
		],
	};
}

function createResidentBindingResolution(input: {
	readonly bindingId: TextureBindingId;
	readonly rect: readonly [number, number, number, number];
	readonly textureHeight: number;
	readonly textureRefId: string;
	readonly textureWidth: number;
}): OpenWorldStreamingTextureCommit["bindingUpdates"][number] {
	return {
		bindingId: input.bindingId,
		readiness: {
			kind: "resident",
			pageVersion: {
				placementRevision: 0,
				textureRefId: input.textureRefId,
			},
			rect: input.rect,
			textureHeight: input.textureHeight,
			textureRefId: input.textureRefId,
			textureWidth: input.textureWidth,
		},
	};
}

function requireUploadBindingId(
	placements: Extract<
		OpenWorldTexturePageBuildOutput,
		{ readonly kind: "page-update" }
	>["placements"],
): TextureBindingId {
	const bindingId = placements[0]?.bindingId;
	if (!bindingId) {
		throw new Error(
			"Page-update texture commits require at least one binding placement.",
		);
	}
	return bindingId;
}
