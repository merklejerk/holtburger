import { deriveTransitionPortalMaskBatchBvhBinding } from "./non-instanced-bvh-bindings";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import {
	buildAcPlacementMatrix,
	createTranslationMat4,
	multiplyMat4,
	type RenderMat4,
} from "./render-math";
import { buildStagedPortalApertureGeometry } from "./staged-world-geometry";
import type { StagedWorldIndexedGeometry } from "./staged-world-geometry";
import type { StagedWorldMaterialPlan } from "./staged-world-materials";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

export interface TransitionPortalMaskDrawUnitAssembly {
	id: string;
	kind: "portal-mask";
	geometry: StagedWorldIndexedGeometry;
	modelMatrix: RenderMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly [];
	bvhBinding: {
		itemKeys: readonly RenderBvhItemKey[];
		fallbackReason: string | null;
	};
	staticPartCount: 0;
	staticObjectKeys: readonly [];
	portalCandidate: TransitionPortalCandidate;
}

export function buildTransitionPortalMaskDrawUnitAssemblies({
	chunkOffsetByKey,
	transitionPortalModel,
}: {
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	transitionPortalModel: TransitionPortalCandidateModel;
}): TransitionPortalMaskDrawUnitAssembly[] {
	return transitionPortalModel.candidates.flatMap((candidate) => {
		const chunkOffset = chunkOffsetByKey.get(candidate.renderChunk.chunkKey);
		if (!chunkOffset || candidate.aperture.points.length < 3) {
			return [];
		}
		const bvhBinding = deriveTransitionPortalMaskBatchBvhBinding(candidate);
		return [
			{
				id: `portal-mask/${candidate.id}`,
				kind: "portal-mask",
				geometry: buildPortalMaskGeometry(candidate),
				modelMatrix: multiplyMat4(
					createTranslationMat4(chunkOffset),
					buildAcPlacementMatrix(
						candidate.aperture.chunkLocalPlacement,
						{ x: 0, y: 0, z: 0 },
						{ x: 1, y: 1, z: 1 },
					),
				),
				material: {
					kind: "flat",
					key: `portal-mask/${candidate.id}`,
					color: new Float32Array([0, 0, 0, 0]),
					behavior: null,
					fallbackReason: null,
					fallbackReasonCode: null,
					preparedAssetIds: [],
				},
				preparedAssetIds: [],
				bvhBinding: {
					itemKeys: bvhBinding.itemKeys,
					fallbackReason: bvhBinding.fallbackReason,
				},
				staticPartCount: 0,
				staticObjectKeys: [],
				portalCandidate: candidate,
			},
		];
	});
}

function buildPortalMaskGeometry(
	candidate: TransitionPortalCandidate,
): StagedWorldIndexedGeometry {
	return buildStagedPortalApertureGeometry(
		candidate.aperture.points,
		`portal-mask:${candidate.id}:points=${candidate.aperture.points.length}`,
	);
}
