import type { TextureBindingId } from "../../../../textures/identity";
import type { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import type {
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildPixelPage,
	OpenWorldTexturePageBuildPlacement,
} from "./protocol";

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
		commit: createOpenWorldStreamingTextureCommitFromPageUpdate(result),
		kind: "accepted",
	};
}

function createOpenWorldStreamingTextureCommitFromPageUpdate(
	result: Extract<
		OpenWorldTexturePageBuildOutput,
		{ readonly kind: "page-update" }
	>,
): OpenWorldStreamingTextureCommit {
	const bindingUpdates = result.placements.map((placement) =>
		createResidentBindingResolution(result.page, placement),
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

function createResidentBindingResolution(
	page: OpenWorldTexturePageBuildPixelPage,
	placement: OpenWorldTexturePageBuildPlacement,
): OpenWorldStreamingTextureCommit["bindingUpdates"][number] {
	return {
		bindingId: placement.bindingId,
		readiness: {
			kind: "resident",
			pageVersion: {
				placementRevision: 0,
				textureRefId: page.textureRefId,
			},
			rect: placement.rect,
			textureHeight: page.height,
			textureRefId: page.textureRefId,
			textureWidth: page.width,
		},
	};
}

function requireUploadBindingId(
	placements: readonly OpenWorldTexturePageBuildPlacement[],
): TextureBindingId {
	const bindingId = placements[0]?.bindingId;
	if (!bindingId) {
		throw new Error(
			"Page-update texture commits require at least one binding placement.",
		);
	}
	return bindingId;
}
