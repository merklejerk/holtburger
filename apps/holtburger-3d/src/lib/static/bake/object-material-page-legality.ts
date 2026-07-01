import type {
	TextureBindingRequirement,
	TexturePlacementSnapshot,
	TextureUsagePurpose,
} from "../../textures/placement";

export interface ObjectMaterialPageRequirementCandidate {
	readonly materialEntryKey: string;
	readonly textureRequirements: readonly TextureBindingRequirement[];
}

export function canAddObjectMaterialPageRequirementCandidate<
	TCandidate extends ObjectMaterialPageRequirementCandidate,
>(options: {
	readonly currentSlice: readonly TCandidate[];
	readonly candidate: TCandidate;
	readonly placementSnapshot: TexturePlacementSnapshot;
	readonly diagnosticSubject: string;
}): boolean {
	const materialEntryKeys = new Set(
		options.currentSlice.map((candidate) => candidate.materialEntryKey),
	);
	if (materialEntryKeys.has(options.candidate.materialEntryKey)) {
		return true;
	}

	const pageSets = createEmptyObjectPurposePageSets();
	const candidatesByEntryKey = new Map<string, TCandidate>();
	for (const candidate of [...options.currentSlice, options.candidate]) {
		if (!candidatesByEntryKey.has(candidate.materialEntryKey)) {
			candidatesByEntryKey.set(candidate.materialEntryKey, candidate);
		}
	}

	for (const candidate of candidatesByEntryKey.values()) {
		addObjectMaterialRequirementPlacementPages({
			candidate,
			diagnosticSubject: options.diagnosticSubject,
			pageSets,
			placementSnapshot: options.placementSnapshot,
		});
	}

	return (
		pageSets.baseColor.size <= 1 &&
		pageSets.detail.size <= 1 &&
		pageSets.index.size <= 1 &&
		pageSets.palette.size <= 1
	);
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
			placement.pageId,
		);
	}
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
