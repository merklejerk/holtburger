import { deriveTransitionPortalMaskBatchBvhBinding } from "./non-instanced-bvh-bindings";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import {
	buildAcPlacementMatrix,
	createTranslationMat4,
	multiplyMat4,
	type RenderMat4,
} from "./render-math";
import { buildPortalApertureRenderGeometry } from "./indexed-render-geometry";
import type { RenderIndexedGeometry } from "./indexed-render-geometry";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

export interface TransitionPortalMaskResourceAssembly {
	id: string;
	kind: "transition-portal-mask";
	geometry: RenderIndexedGeometry;
	renderChunkKey: string;
	chunkLocalPlacement: TransitionPortalCandidate["aperture"]["chunkLocalPlacement"];
	bvhBinding: {
		itemKeys: readonly RenderBvhItemKey[];
		fallbackReason: string | null;
	};
	portalCandidate: TransitionPortalCandidate;
}

export function buildTransitionPortalMaskResourceAssemblies({
	transitionPortalModel,
}: {
	transitionPortalModel: TransitionPortalCandidateModel;
}): TransitionPortalMaskResourceAssembly[] {
	return transitionPortalModel.candidates.flatMap((candidate) => {
		if (candidate.aperture.points.length < 3) {
			return [];
		}
		const bvhBinding = deriveTransitionPortalMaskBatchBvhBinding(candidate);
		return [
			{
				id: `portal-mask/${candidate.id}`,
				kind: "transition-portal-mask",
				geometry: buildPortalMaskGeometry(candidate),
				renderChunkKey: candidate.renderChunk.chunkKey,
				chunkLocalPlacement: candidate.aperture.chunkLocalPlacement,
				bvhBinding: {
					itemKeys: bvhBinding.itemKeys,
					fallbackReason: bvhBinding.fallbackReason,
				},
				portalCandidate: candidate,
			},
		];
	});
}

export function resolveTransitionPortalMaskModelMatrix({
	mask,
	renderChunkTransforms,
}: {
	mask: Pick<
		TransitionPortalMaskResourceAssembly,
		"renderChunkKey" | "chunkLocalPlacement"
	>;
	renderChunkTransforms: readonly RenderChunkTransform[];
}): RenderMat4 | null {
	const chunkOffset = renderChunkTransforms.find(
		(transform) => transform.chunkKey === mask.renderChunkKey,
	)?.offset;
	if (!chunkOffset) {
		return null;
	}
	return multiplyMat4(
		createTranslationMat4(chunkOffset),
		buildAcPlacementMatrix(
			mask.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
}

function buildPortalMaskGeometry(
	candidate: TransitionPortalCandidate,
): RenderIndexedGeometry {
	return buildPortalApertureRenderGeometry(
		candidate.aperture.points,
		`portal-mask:${candidate.id}:points=${candidate.aperture.points.length}`,
	);
}
