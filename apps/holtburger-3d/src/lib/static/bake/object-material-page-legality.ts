import type {
	TextureBindingRequirement,
	TexturePlacementSnapshot,
	TextureUsagePurpose,
} from "../../textures/placement";
import type {
	StaticMaterialBatchCandidate,
	StaticMaterialBatchSliceGuard,
} from "./static-material-batch-slicer";

export interface ObjectMaterialPageRequirementCandidate {
	readonly materialEntryKey: string;
	readonly textureRequirements: readonly TextureBindingRequirement[];
}

export function createObjectMaterialPageRequirementSliceGuard<
	TCandidate extends StaticMaterialBatchCandidate &
		ObjectMaterialPageRequirementCandidate,
>(options: {
	readonly placementSnapshot: TexturePlacementSnapshot;
	readonly diagnosticSubject: string;
}): StaticMaterialBatchSliceGuard<TCandidate> {
	let pageSets = createEmptyObjectPurposePageSets();
	let acceptedPageLegalityKeys = new Set<string>();

	return {
		acceptCandidate(candidate) {
			const pageLegalityKey = createObjectMaterialPageLegalityKey(candidate);
			if (acceptedPageLegalityKeys.has(pageLegalityKey)) {
				return;
			}
			addObjectMaterialRequirementPlacementPages({
				candidate,
				diagnosticSubject: options.diagnosticSubject,
				pageSets,
				placementSnapshot: options.placementSnapshot,
			});
			acceptedPageLegalityKeys.add(pageLegalityKey);
		},
		canAddCandidate(candidate) {
			if (
				acceptedPageLegalityKeys.has(
					createObjectMaterialPageLegalityKey(candidate),
				)
			) {
				return true;
			}

			return candidateTextureRequirementsFitPageSets({
				candidate,
				diagnosticSubject: options.diagnosticSubject,
				pageSets,
				placementSnapshot: options.placementSnapshot,
			});
		},
		reset() {
			pageSets = createEmptyObjectPurposePageSets();
			acceptedPageLegalityKeys = new Set<string>();
		},
	};
}

function createObjectMaterialPageLegalityKey(
	candidate: ObjectMaterialPageRequirementCandidate,
): string {
	return [
		candidate.materialEntryKey,
		...candidate.textureRequirements.map((requirement) =>
			[
				requirement.purpose,
				requirement.placementItemId,
				requirement.sourceKey,
			].join(":"),
		),
	].join("|");
}

function addObjectMaterialRequirementPlacementPages<
	TCandidate extends ObjectMaterialPageRequirementCandidate,
>(options: {
	readonly candidate: TCandidate;
	readonly diagnosticSubject: string;
	readonly pageSets: ObjectPurposePageSets;
	readonly placementSnapshot: TexturePlacementSnapshot;
}): void {
	for (const requirement of options.candidate.textureRequirements) {
		const placement = options.placementSnapshot.placementsByItemId.get(
			requirement.placementItemId,
		);
		if (!placement) {
			throw new Error(
				`${options.diagnosticSubject} texture placement snapshot is missing ${requirement.placementItemId}.`,
			);
		}
		getObjectPurposePageSet(options.pageSets, placement.purpose).add(
			placement.textureRefId,
		);
	}
}

function candidateTextureRequirementsFitPageSets<
	TCandidate extends ObjectMaterialPageRequirementCandidate,
>(options: {
	readonly candidate: TCandidate;
	readonly diagnosticSubject: string;
	readonly pageSets: ObjectPurposePageSets;
	readonly placementSnapshot: TexturePlacementSnapshot;
}): boolean {
	for (const requirement of options.candidate.textureRequirements) {
		const placement = options.placementSnapshot.placementsByItemId.get(
			requirement.placementItemId,
		);
		if (!placement) {
			throw new Error(
				`${options.diagnosticSubject} texture placement snapshot is missing ${requirement.placementItemId}.`,
			);
		}
		const pageSet = getObjectPurposePageSet(options.pageSets, placement.purpose);
		if (pageSet.size > 0 && !pageSet.has(placement.textureRefId)) {
			return false;
		}
	}
	return true;
}

interface ObjectPurposePageSets {
	readonly baseColor: Set<string>;
	readonly detail: Set<string>;
	readonly index: Set<string>;
	readonly palette: Set<string>;
}

function createEmptyObjectPurposePageSets(): ObjectPurposePageSets {
	return {
		baseColor: new Set(),
		detail: new Set(),
		index: new Set(),
		palette: new Set(),
	};
}

function getObjectPurposePageSet(
	pageSets: ObjectPurposePageSets,
	purpose: TextureUsagePurpose,
): Set<string> {
	switch (purpose) {
		case "object-base-color":
			return pageSets.baseColor;
		case "object-detail":
			return pageSets.detail;
		case "object-index":
			return pageSets.index;
		case "object-palette":
			return pageSets.palette;
		case "terrain-color":
		case "terrain-detail":
		case "terrain-mask":
			throw new Error(
				`Object material placement received incompatible texture purpose ${purpose}.`,
			);
	}
}
