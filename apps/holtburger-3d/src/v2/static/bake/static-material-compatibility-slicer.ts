export interface StaticMaterialCompatibilityCandidate {
	readonly compatibilityKey: string;
	readonly materialEntryKey: string;
}

export interface StaticMaterialCompatibilitySlice<
	TCandidate extends StaticMaterialCompatibilityCandidate,
> {
	readonly compatibilityKey: string;
	readonly compatibilityIndex: number;
	readonly sliceIndex: number;
	readonly sliceId: string;
	readonly candidates: readonly TCandidate[];
}

export function sliceStaticMaterialCompatibilityCandidates<
	TCandidate extends StaticMaterialCompatibilityCandidate,
>(options: {
	readonly candidates: readonly TCandidate[];
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialCompatibilitySlice<TCandidate>[] {
	const candidatesByCompatibility = groupByCompatibility(options.candidates);

	return [...candidatesByCompatibility.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([compatibilityKey, group], compatibilityIndex) =>
			createCompatibilitySlices({
				candidates: group,
				compatibilityIndex,
				compatibilityKey,
				maxMaterialEntriesPerSlice: options.maxMaterialEntriesPerSlice,
			}),
		);
}

function groupByCompatibility<
	TCandidate extends StaticMaterialCompatibilityCandidate,
>(candidates: readonly TCandidate[]): Map<string, readonly TCandidate[]> {
	const groups = new Map<string, TCandidate[]>();

	for (const candidate of candidates) {
		const group = groups.get(candidate.compatibilityKey);
		if (group) {
			group.push(candidate);
		} else {
			groups.set(candidate.compatibilityKey, [candidate]);
		}
	}

	return groups;
}

function createCompatibilitySlices<
	TCandidate extends StaticMaterialCompatibilityCandidate,
>(options: {
	readonly candidates: readonly TCandidate[];
	readonly compatibilityKey: string;
	readonly compatibilityIndex: number;
	readonly maxMaterialEntriesPerSlice: number;
}): readonly StaticMaterialCompatibilitySlice<TCandidate>[] {
	const slices: TCandidate[][] = [];
	let currentSlice: TCandidate[] = [];
	let currentMaterialKeys = new Set<string>();

	for (const candidate of options.candidates) {
		if (
			!currentMaterialKeys.has(candidate.materialEntryKey) &&
			currentMaterialKeys.size >= options.maxMaterialEntriesPerSlice
		) {
			slices.push(currentSlice);
			currentSlice = [];
			currentMaterialKeys = new Set<string>();
		}

		currentSlice.push(candidate);
		currentMaterialKeys.add(candidate.materialEntryKey);
	}

	if (currentSlice.length > 0) {
		slices.push(currentSlice);
	}

	return slices.map((slice, sliceIndex) => ({
		candidates: slice,
		compatibilityIndex: options.compatibilityIndex,
		compatibilityKey: options.compatibilityKey,
		sliceId: `slice/${options.compatibilityIndex}/${sliceIndex}`,
		sliceIndex,
	}));
}
