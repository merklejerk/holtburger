import {
	createPortalModelAperture,
	createPortalModelScene,
	portalModelBatchId,
	portalModelCrossingId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
	portalModelSubmissionId,
	type PortalModelDomain,
	type PortalModelFragment,
	type PortalModelScene,
	type PortalModelScopeId,
} from "./portal-model";

export interface PortalModelEnumerationBounds {
	readonly maximumCrossingCount: number;
	readonly maximumScopeCount: number;
}

/** Auditable corpus counts; each scene is deterministic and replayable as JSON. */
export interface PortalModelCorpus {
	readonly diagnostics: {
		readonly domainPartitionCount: number;
		readonly sceneCount: number;
		readonly topologyCount: number;
	};
	readonly scenes: readonly PortalModelScene[];
}

export interface PortalModelSeededCorpusInput {
	readonly crossingCount: number;
	readonly sceneCount: number;
	readonly scopeCount: number;
	readonly seed: number;
}

type FragmentVariant =
	"additive" | "alpha-blended" | "alpha-test" | "opaque" | "particle";

interface DirectedEdge {
	readonly sourceIndex: number;
	readonly targetIndex: number;
}

const FRAGMENT_VARIANTS: readonly FragmentVariant[] = [
	"opaque",
	"alpha-test",
	"alpha-blended",
	"additive",
	"particle",
];

/**
 * Exhaust every directed graph, crossing-depth permutation, canonical domain partition, and
 * fragment class inside a deliberately small one-pixel bound.
 */
export function enumeratePortalModelCorpus(
	bounds: PortalModelEnumerationBounds,
): PortalModelCorpus {
	validateBounds(bounds);
	const scenes: PortalModelScene[] = [];
	let domainPartitionCount = 0;
	let topologyCount = 0;
	for (
		let scopeCount = 1;
		scopeCount <= bounds.maximumScopeCount;
		scopeCount += 1
	) {
		const edges = directedEdges(scopeCount);
		const partitions = canonicalPartitions(scopeCount);
		domainPartitionCount += partitions.length;
		for (const subset of subsets(edges, bounds.maximumCrossingCount)) {
			for (const depthOrder of permutations(subset.length)) {
				topologyCount += 1;
				for (const partition of partitions) {
					for (const fragmentVariant of FRAGMENT_VARIANTS) {
						scenes.push(
							createEnumeratedScene(
								scopeCount,
								subset,
								depthOrder,
								partition,
								fragmentVariant,
							),
						);
					}
				}
			}
		}
	}
	return Object.freeze({
		diagnostics: Object.freeze({
			domainPartitionCount,
			sceneCount: scenes.length,
			topologyCount,
		}),
		scenes: Object.freeze(scenes),
	});
}

/** Generate reproducible larger cyclic/diamond/re-entry candidates beyond the exhaustive bound. */
export function generateSeededPortalModelScenes(
	input: PortalModelSeededCorpusInput,
): readonly PortalModelScene[] {
	validateSeededInput(input);
	const random = seededRandom(input.seed);
	const availableEdges = directedEdges(input.scopeCount);
	const scenes: PortalModelScene[] = [];
	for (let sceneIndex = 0; sceneIndex < input.sceneCount; sceneIndex += 1) {
		const edges = shuffled(availableEdges, random).slice(
			0,
			input.crossingCount,
		);
		const depthOrder = shuffled(
			Array.from({ length: edges.length }, (_, index) => index),
			random,
		);
		const partition = [0];
		let maximumDomain = 0;
		for (let scopeIndex = 1; scopeIndex < input.scopeCount; scopeIndex += 1) {
			const domain = Math.floor(random() * (maximumDomain + 2));
			partition.push(domain);
			maximumDomain = Math.max(maximumDomain, domain);
		}
		scenes.push(
			createEnumeratedScene(
				input.scopeCount,
				edges,
				depthOrder,
				partition,
				FRAGMENT_VARIANTS[sceneIndex % FRAGMENT_VARIANTS.length]!,
			),
		);
	}
	return Object.freeze(scenes);
}

function createEnumeratedScene(
	scopeCount: number,
	edges: readonly DirectedEdge[],
	depthOrder: readonly number[],
	partition: readonly number[],
	fragmentVariant: FragmentVariant,
): PortalModelScene {
	const pixelCount = 1;
	const pixel = portalModelPixel(0, pixelCount);
	const scopeIds = Array.from({ length: scopeCount }, (_, index) =>
		portalModelScopeId(`scope-${index}`),
	);
	const maximumPortalDepth = edges.length * 4;
	const domainCount = Math.max(...partition) + 1;
	const domains: PortalModelDomain[] = Array.from(
		{ length: domainCount },
		(_, domainIndex) => ({
			fragments: scopeIds.flatMap((scopeId, scopeIndex) =>
				partition[scopeIndex] === domainIndex
					? fragmentsForVariant(
							scopeId,
							scopeIndex,
							domainIndex,
							maximumPortalDepth,
							fragmentVariant,
						)
					: [],
			),
			id: portalModelDomainId(`domain-${domainIndex}`),
		}),
	);
	return createPortalModelScene({
		crossings: edges.map((edge, edgeIndex) => {
			const sourceScopeId = requiredScope(scopeIds, edge.sourceIndex);
			const targetScopeId = requiredScope(scopeIds, edge.targetIndex);
			return {
				aperture: createPortalModelAperture(pixelCount, [
					{
						depth: portalModelDepth((depthOrder[edgeIndex]! + 1) * 4),
						pixel,
					},
				]),
				id: portalModelCrossingId(
					`crossing-${edge.sourceIndex}-${edge.targetIndex}`,
				),
				junctionGroupId: null,
				reciprocalCrossingId: null,
				relationship:
					partition[edge.sourceIndex] === partition[edge.targetIndex]
						? ("depth-continuous" as const)
						: ("indoor-boundary" as const),
				sourceScopeId,
				targetScopeId,
			};
		}),
		domains,
		pixelCount,
		rootScopeId: requiredScope(scopeIds, 0),
		scopes: scopeIds.map((id, scopeIndex) => ({
			domainId: portalModelDomainId(`domain-${partition[scopeIndex]}`),
			id,
		})),
	});
}

function fragmentsForVariant(
	scopeId: PortalModelScopeId,
	scopeIndex: number,
	domainIndex: number,
	maximumPortalDepth: number,
	variant: FragmentVariant,
): PortalModelFragment[] {
	const pixel = portalModelPixel(0, 1);
	const terminalDepth = portalModelDepth(
		maximumPortalDepth + 10 + scopeIndex * 3,
	);
	const nearDepth = portalModelDepth(-10 - scopeIndex * 3);
	const fragment = (kind: FragmentVariant): PortalModelFragment => {
		const common = {
			batchId: portalModelBatchId(`${kind}-batch-${domainIndex}`),
			depth: nearDepth,
			id: portalModelFragmentId(`${kind}-${scopeIndex}`),
			pixel,
			scopeId,
			submissionId: portalModelSubmissionId(`${kind}-submission-${scopeIndex}`),
		};
		switch (kind) {
			case "additive":
				return { ...common, kind };
			case "alpha-blended":
				return { ...common, kind };
			case "alpha-test":
				return { ...common, kind, passes: false };
			case "opaque":
				return { ...common, depth: terminalDepth, kind };
			case "particle":
				return { ...common, blend: "alpha-blended", kind };
		}
	};
	if (variant === "opaque") return [fragment(variant)];
	return [
		fragment(variant),
		{
			batchId: portalModelBatchId(`opaque-batch-${domainIndex}`),
			depth: terminalDepth,
			id: portalModelFragmentId(`terminal-opaque-${scopeIndex}`),
			kind: "opaque",
			pixel,
			scopeId,
			submissionId: portalModelSubmissionId(
				`terminal-opaque-submission-${scopeIndex}`,
			),
		},
	];
}

function directedEdges(scopeCount: number): DirectedEdge[] {
	const result: DirectedEdge[] = [];
	for (let sourceIndex = 0; sourceIndex < scopeCount; sourceIndex += 1) {
		for (let targetIndex = 0; targetIndex < scopeCount; targetIndex += 1) {
			if (sourceIndex !== targetIndex)
				result.push({ sourceIndex, targetIndex });
		}
	}
	return result;
}

function subsets<Item>(
	items: readonly Item[],
	maximumSize: number,
): readonly (readonly Item[])[] {
	const result: Item[][] = [];
	const visit = (start: number, selected: Item[]): void => {
		result.push([...selected]);
		if (selected.length === maximumSize) return;
		for (let index = start; index < items.length; index += 1) {
			selected.push(items[index]!);
			visit(index + 1, selected);
			selected.pop();
		}
	};
	visit(0, []);
	return result;
}

function permutations(length: number): readonly (readonly number[])[] {
	if (length === 0) return [[]];
	const result: number[][] = [];
	const remaining = Array.from({ length }, (_, index) => index);
	const visit = (prefix: number[], available: readonly number[]): void => {
		if (available.length === 0) {
			result.push(prefix);
			return;
		}
		for (let index = 0; index < available.length; index += 1) {
			visit(
				[...prefix, available[index]!],
				available.filter((_, candidateIndex) => candidateIndex !== index),
			);
		}
	};
	visit([], remaining);
	return result;
}

function canonicalPartitions(length: number): readonly (readonly number[])[] {
	const result: number[][] = [];
	const visit = (partition: number[], maximum: number): void => {
		if (partition.length === length) {
			result.push([...partition]);
			return;
		}
		for (let value = 0; value <= maximum + 1; value += 1) {
			partition.push(value);
			visit(partition, Math.max(maximum, value));
			partition.pop();
		}
	};
	visit([0], 0);
	return result;
}

function requiredScope(
	scopeIds: readonly PortalModelScopeId[],
	index: number,
): PortalModelScopeId {
	const scopeId = scopeIds[index];
	if (!scopeId) throw new Error(`Missing enumerated portal scope ${index}.`);
	return scopeId;
}

function validateBounds(bounds: PortalModelEnumerationBounds): void {
	if (
		!Number.isInteger(bounds.maximumScopeCount) ||
		bounds.maximumScopeCount <= 0
	) {
		throw new Error(
			"Portal model maximum scope count must be a positive integer.",
		);
	}
	if (
		!Number.isInteger(bounds.maximumCrossingCount) ||
		bounds.maximumCrossingCount < 0
	) {
		throw new Error(
			"Portal model maximum crossing count must be a non-negative integer.",
		);
	}
}

function validateSeededInput(input: PortalModelSeededCorpusInput): void {
	validateBounds({
		maximumCrossingCount: input.crossingCount,
		maximumScopeCount: input.scopeCount,
	});
	if (!Number.isInteger(input.sceneCount) || input.sceneCount <= 0) {
		throw new Error(
			"Portal model seeded scene count must be a positive integer.",
		);
	}
	if (input.crossingCount > input.scopeCount * (input.scopeCount - 1)) {
		throw new Error(
			"Portal model seeded crossing count exceeds the directed graph capacity.",
		);
	}
	if (!Number.isSafeInteger(input.seed)) {
		throw new Error("Portal model seed must be a safe integer.");
	}
}

function shuffled<Item>(items: readonly Item[], random: () => number): Item[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const other = Math.floor(random() * (index + 1));
		const value = result[index]!;
		result[index] = result[other]!;
		result[other] = value;
	}
	return result;
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}
