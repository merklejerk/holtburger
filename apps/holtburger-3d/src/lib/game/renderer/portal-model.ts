type Brand<Value, Name extends string> = Value & {
	readonly __portalModelBrand: Name;
};

/** Stable identity for one reusable content-preparation domain. */
export type PortalModelDomainId = Brand<string, "portal-model-domain-id">;

/** Exact prepared-state compatibility group used by structural draw-cost accounting. */
export type PortalModelBatchId = Brand<string, "portal-model-batch-id">;

/** Stable identity for one authored visibility scope. */
export type PortalModelScopeId = Brand<string, "portal-model-scope-id">;

/** Stable identity for one directed portal crossing. */
export type PortalModelCrossingId = Brand<string, "portal-model-crossing-id">;

/** Stable identity for one symbolic raster fragment. */
export type PortalModelFragmentId = Brand<string, "portal-model-fragment-id">;

/** One prepared draw item whose pixel samples share ordering and batch compatibility. */
export type PortalModelSubmissionId = Brand<
	string,
	"portal-model-submission-id"
>;

/** Stable identity for one path-specific portal view. */
export type PortalModelViewId = Brand<string, "portal-model-view-id">;

/** Small exact camera-depth rank; lower values are nearer the camera. */
export type PortalModelDepth = Brand<number, "portal-model-depth">;

/** One pixel in the model's finite screen. */
export type PortalModelPixel = Brand<number, "portal-model-pixel">;

/** Immutable finite-screen coverage, stored as JSON-safe unsigned 32-bit words. */
export interface PortalModelFootprint {
	readonly pixelCount: number;
	readonly words: readonly number[];
}

/** One portal-plane sample for a covered finite-screen pixel. */
export interface PortalModelApertureSample {
	readonly depth: PortalModelDepth;
	readonly pixel: PortalModelPixel;
}

/** Exact finite-screen aperture and portal-plane depth at every covered pixel. */
export interface PortalModelAperture {
	readonly depthByPixel: readonly (PortalModelDepth | null)[];
	readonly footprint: PortalModelFootprint;
}

interface PortalModelFragmentBase {
	readonly batchId: PortalModelBatchId;
	readonly depth: PortalModelDepth;
	readonly id: PortalModelFragmentId;
	readonly pixel: PortalModelPixel;
	readonly scopeId: PortalModelScopeId;
	readonly submissionId: PortalModelSubmissionId;
}

/** Depth-writing fragment. */
interface PortalModelOpaqueFragment extends PortalModelFragmentBase {
	readonly kind: "opaque";
}

/** Cutout fragment whose authored alpha test has already been resolved. */
interface PortalModelAlphaTestFragment extends PortalModelFragmentBase {
	readonly kind: "alpha-test";
	readonly passes: boolean;
}

/** Ordered source-over fragment. */
interface PortalModelAlphaBlendedFragment extends PortalModelFragmentBase {
	readonly kind: "alpha-blended";
}

/** Additive fragment, modeled as order-independent after depth rejection. */
interface PortalModelAdditiveFragment extends PortalModelFragmentBase {
	readonly kind: "additive";
}

/** Particle fragment sharing the exact alpha or additive compositor contract. */
interface PortalModelParticleFragment extends PortalModelFragmentBase {
	readonly blend: "additive" | "alpha-blended";
	readonly kind: "particle";
}

export type PortalModelFragment =
	| PortalModelAdditiveFragment
	| PortalModelAlphaBlendedFragment
	| PortalModelAlphaTestFragment
	| PortalModelOpaqueFragment
	| PortalModelParticleFragment;

/** Reusable preparation owner. Fragments retain their authored scope for ray semantics. */
export interface PortalModelDomain {
	readonly fragments: readonly PortalModelFragment[];
	readonly id: PortalModelDomainId;
}

/** One authored scope assigned to exactly one reusable content domain. */
interface PortalModelScope {
	readonly domainId: PortalModelDomainId;
	readonly id: PortalModelScopeId;
}

/** One directed topology transition with an explicit reciprocal when physically paired. */
export interface PortalModelCrossing {
	readonly aperture: PortalModelAperture;
	readonly id: PortalModelCrossingId;
	readonly reciprocalCrossingId: PortalModelCrossingId | null;
	readonly relationship:
		"depth-continuous" | "exterior-boundary" | "indoor-boundary";
	readonly sourceScopeId: PortalModelScopeId;
	readonly targetScopeId: PortalModelScopeId;
}

/** Validated, serializable input for all portal compositor models. */
export interface PortalModelScene {
	readonly crossings: readonly PortalModelCrossing[];
	readonly domains: readonly PortalModelDomain[];
	readonly pixelCount: number;
	readonly rootScopeId: PortalModelScopeId;
	readonly scopes: readonly PortalModelScope[];
}

export function portalModelDomainId(value: string): PortalModelDomainId {
	return validatedId(value, "domain") as PortalModelDomainId;
}

export function portalModelBatchId(value: string): PortalModelBatchId {
	return validatedId(value, "batch") as PortalModelBatchId;
}

export function portalModelScopeId(value: string): PortalModelScopeId {
	return validatedId(value, "scope") as PortalModelScopeId;
}

export function portalModelCrossingId(value: string): PortalModelCrossingId {
	return validatedId(value, "crossing") as PortalModelCrossingId;
}

export function portalModelFragmentId(value: string): PortalModelFragmentId {
	return validatedId(value, "fragment") as PortalModelFragmentId;
}

export function portalModelSubmissionId(
	value: string,
): PortalModelSubmissionId {
	return validatedId(value, "submission") as PortalModelSubmissionId;
}

export function portalModelViewId(value: string): PortalModelViewId {
	return validatedId(value, "view") as PortalModelViewId;
}

export function portalModelDepth(value: number): PortalModelDepth {
	if (!Number.isSafeInteger(value)) {
		throw new Error(`Portal model depth ${value} must be a safe integer.`);
	}
	return value as PortalModelDepth;
}

export function portalModelPixel(
	value: number,
	pixelCount: number,
): PortalModelPixel {
	validatePixelCount(pixelCount);
	if (!Number.isInteger(value) || value < 0 || value >= pixelCount) {
		throw new Error(
			`Portal model pixel ${value} must be an integer in [0, ${pixelCount}).`,
		);
	}
	return value as PortalModelPixel;
}

export function createPortalModelFootprint(
	pixelCount: number,
	pixels: readonly number[],
): PortalModelFootprint {
	validatePixelCount(pixelCount);
	const words = Array<number>(Math.ceil(pixelCount / 32)).fill(0);
	for (const value of pixels) {
		const pixel = portalModelPixel(value, pixelCount);
		const wordIndex = Math.floor(pixel / 32);
		const bitIndex = pixel % 32;
		const mask = 1 << bitIndex;
		if ((words[wordIndex]! & mask) !== 0) {
			throw new Error(`Portal model footprint repeats pixel ${pixel}.`);
		}
		words[wordIndex] = (words[wordIndex]! | mask) >>> 0;
	}
	return Object.freeze({
		pixelCount,
		words: Object.freeze(words),
	});
}

export function portalModelFootprintHas(
	footprint: PortalModelFootprint,
	pixel: PortalModelPixel,
): boolean {
	validateFootprint(footprint);
	portalModelPixel(pixel, footprint.pixelCount);
	const wordIndex = Math.floor(pixel / 32);
	const bitIndex = pixel % 32;
	return (footprint.words[wordIndex]! & (1 << bitIndex)) !== 0;
}

export function portalModelFootprintCardinality(
	footprint: PortalModelFootprint,
): number {
	validateFootprint(footprint);
	let count = 0;
	for (const word of footprint.words) {
		let remaining = word >>> 0;
		while (remaining !== 0) {
			remaining = (remaining & (remaining - 1)) >>> 0;
			count += 1;
		}
	}
	return count;
}

export function intersectPortalModelFootprints(
	left: PortalModelFootprint,
	right: PortalModelFootprint,
): PortalModelFootprint {
	validateMatchingFootprints(left, right);
	return footprintFromWords(
		left.pixelCount,
		left.words.map((word, index) => (word & right.words[index]!) >>> 0),
	);
}

export function unionPortalModelFootprints(
	left: PortalModelFootprint,
	right: PortalModelFootprint,
): PortalModelFootprint {
	validateMatchingFootprints(left, right);
	return footprintFromWords(
		left.pixelCount,
		left.words.map((word, index) => (word | right.words[index]!) >>> 0),
	);
}

export function subtractPortalModelFootprints(
	left: PortalModelFootprint,
	right: PortalModelFootprint,
): PortalModelFootprint {
	validateMatchingFootprints(left, right);
	return footprintFromWords(
		left.pixelCount,
		left.words.map((word, index) => (word & ~right.words[index]!) >>> 0),
	);
}

export function portalModelFootprintContains(
	container: PortalModelFootprint,
	candidate: PortalModelFootprint,
): boolean {
	validateMatchingFootprints(container, candidate);
	return candidate.words.every(
		(word, index) => (word & ~container.words[index]!) === 0,
	);
}

export function portalModelFootprintsOverlap(
	left: PortalModelFootprint,
	right: PortalModelFootprint,
): boolean {
	validateMatchingFootprints(left, right);
	return left.words.some((word, index) => (word & right.words[index]!) !== 0);
}

export function createPortalModelAperture(
	pixelCount: number,
	samples: readonly PortalModelApertureSample[],
): PortalModelAperture {
	const depthByPixel = Array<PortalModelDepth | null>(pixelCount).fill(null);
	for (const sample of samples) {
		const pixel = portalModelPixel(sample.pixel, pixelCount);
		if (depthByPixel[pixel] !== null) {
			throw new Error(`Portal model aperture repeats pixel ${pixel}.`);
		}
		depthByPixel[pixel] = portalModelDepth(sample.depth);
	}
	return Object.freeze({
		depthByPixel: Object.freeze(depthByPixel),
		footprint: createPortalModelFootprint(
			pixelCount,
			samples.map(({ pixel }) => pixel),
		),
	});
}

export function createPortalModelScene(
	input: PortalModelScene,
): PortalModelScene {
	validatePixelCount(input.pixelCount);
	const scopes = input.scopes.map((scope) => Object.freeze({ ...scope }));
	const domains = input.domains.map((domain) =>
		Object.freeze({
			...domain,
			fragments: Object.freeze(
				domain.fragments.map((fragment) => Object.freeze({ ...fragment })),
			),
		}),
	);
	const crossings = input.crossings.map((crossing) =>
		Object.freeze({
			...crossing,
			aperture: Object.freeze({
				depthByPixel: Object.freeze([...crossing.aperture.depthByPixel]),
				footprint: footprintFromWords(
					crossing.aperture.footprint.pixelCount,
					crossing.aperture.footprint.words,
				),
			}),
		}),
	);
	const scene = Object.freeze({
		crossings: Object.freeze(crossings),
		domains: Object.freeze(domains),
		pixelCount: input.pixelCount,
		rootScopeId: input.rootScopeId,
		scopes: Object.freeze(scopes),
	});
	validatePortalModelScene(scene);
	return scene;
}

export function validatePortalModelScene(scene: PortalModelScene): void {
	validatePixelCount(scene.pixelCount);
	const scopeById = uniqueById(scene.scopes, "scope");
	const domainById = uniqueById(scene.domains, "domain");
	const crossingById = uniqueById(scene.crossings, "crossing");
	const fragmentById = new Map<PortalModelFragmentId, PortalModelFragment>();
	const batchOwnerById = new Map<
		PortalModelBatchId,
		{ readonly domainId: PortalModelDomainId; readonly phase: string }
	>();
	const submissionOwnerById = new Map<
		PortalModelSubmissionId,
		{
			readonly batchId: PortalModelBatchId;
			readonly depth: PortalModelDepth;
			readonly domainId: PortalModelDomainId;
			readonly phase: string;
			readonly scopeId: PortalModelScopeId;
		}
	>();

	if (!scopeById.has(scene.rootScopeId)) {
		throw new Error(
			`Portal model root scope ${scene.rootScopeId} does not exist.`,
		);
	}
	for (const scope of scene.scopes) {
		if (!domainById.has(scope.domainId)) {
			throw new Error(
				`Portal model scope ${scope.id} references missing domain ${scope.domainId}.`,
			);
		}
	}
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			if (fragmentById.has(fragment.id)) {
				throw new Error(`Portal model repeats fragment id ${fragment.id}.`);
			}
			fragmentById.set(fragment.id, fragment);
			const scope = scopeById.get(fragment.scopeId);
			if (!scope) {
				throw new Error(
					`Portal model fragment ${fragment.id} references missing scope ${fragment.scopeId}.`,
				);
			}
			if (scope.domainId !== domain.id) {
				throw new Error(
					`Portal model fragment ${fragment.id} belongs to domain ${domain.id}, but scope ${scope.id} belongs to ${scope.domainId}.`,
				);
			}
			portalModelPixel(fragment.pixel, scene.pixelCount);
			portalModelDepth(fragment.depth);
			const phase = fragmentBatchPhase(fragment);
			const batchOwner = batchOwnerById.get(fragment.batchId);
			if (
				batchOwner &&
				(batchOwner.domainId !== domain.id || batchOwner.phase !== phase)
			) {
				throw new Error(
					`Portal model batch ${fragment.batchId} mixes ${batchOwner.domainId}/${batchOwner.phase} with ${domain.id}/${phase}.`,
				);
			}
			batchOwnerById.set(fragment.batchId, { domainId: domain.id, phase });
			const submissionOwner = submissionOwnerById.get(fragment.submissionId);
			if (
				submissionOwner &&
				(submissionOwner.batchId !== fragment.batchId ||
					submissionOwner.depth !== fragment.depth ||
					submissionOwner.domainId !== domain.id ||
					submissionOwner.phase !== phase ||
					submissionOwner.scopeId !== fragment.scopeId)
			) {
				throw new Error(
					`Portal model submission ${fragment.submissionId} has inconsistent domain, batch, phase, or order depth.`,
				);
			}
			submissionOwnerById.set(fragment.submissionId, {
				batchId: fragment.batchId,
				depth: fragment.depth,
				domainId: domain.id,
				phase,
				scopeId: fragment.scopeId,
			});
		}
	}
	for (const crossing of scene.crossings) {
		if (!scopeById.has(crossing.sourceScopeId)) {
			throw new Error(
				`Portal model crossing ${crossing.id} references missing source scope ${crossing.sourceScopeId}.`,
			);
		}
		if (!scopeById.has(crossing.targetScopeId)) {
			throw new Error(
				`Portal model crossing ${crossing.id} references missing target scope ${crossing.targetScopeId}.`,
			);
		}
		validateAperture(crossing.aperture, scene.pixelCount, crossing.id);
		if (crossing.reciprocalCrossingId === null) continue;
		if (crossing.reciprocalCrossingId === crossing.id) {
			throw new Error(
				`Portal model crossing ${crossing.id} is its own reciprocal.`,
			);
		}
		const reciprocal = crossingById.get(crossing.reciprocalCrossingId);
		if (!reciprocal) {
			throw new Error(
				`Portal model crossing ${crossing.id} references missing reciprocal ${crossing.reciprocalCrossingId}.`,
			);
		}
		if (
			reciprocal.reciprocalCrossingId !== crossing.id ||
			reciprocal.sourceScopeId !== crossing.targetScopeId ||
			reciprocal.targetScopeId !== crossing.sourceScopeId
		) {
			throw new Error(
				`Portal model crossing ${crossing.id} has an inconsistent reciprocal ${reciprocal.id}.`,
			);
		}
	}
	validateLocalDepthTies(scene);
}

function fragmentBatchPhase(fragment: PortalModelFragment): string {
	switch (fragment.kind) {
		case "opaque":
			return "opaque";
		case "alpha-test":
			return "alpha-test";
		case "alpha-blended":
			return "alpha-blended";
		case "additive":
			return "additive";
		case "particle":
			return `particle-${fragment.blend}`;
	}
}

function validatedId(value: string, kind: string): string {
	if (value.trim().length === 0) {
		throw new Error(`Portal model ${kind} id must not be empty.`);
	}
	return value;
}

function validatePixelCount(pixelCount: number): void {
	if (!Number.isInteger(pixelCount) || pixelCount <= 0) {
		throw new Error(
			`Portal model pixel count ${pixelCount} must be a positive integer.`,
		);
	}
}

function validateFootprint(footprint: PortalModelFootprint): void {
	validatePixelCount(footprint.pixelCount);
	const expectedWordCount = Math.ceil(footprint.pixelCount / 32);
	if (footprint.words.length !== expectedWordCount) {
		throw new Error(
			`Portal model footprint has ${footprint.words.length} words; expected ${expectedWordCount}.`,
		);
	}
	for (const word of footprint.words) {
		if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) {
			throw new Error(`Portal model footprint word ${word} is not uint32.`);
		}
	}
	const remainder = footprint.pixelCount % 32;
	if (remainder === 0) return;
	const validMask = 0xffffffff >>> (32 - remainder);
	const finalWord = footprint.words[footprint.words.length - 1]!;
	if ((finalWord & ~validMask) !== 0) {
		throw new Error("Portal model footprint covers an out-of-range pixel.");
	}
}

function validateMatchingFootprints(
	left: PortalModelFootprint,
	right: PortalModelFootprint,
): void {
	validateFootprint(left);
	validateFootprint(right);
	if (left.pixelCount !== right.pixelCount) {
		throw new Error(
			`Portal model footprint sizes differ: ${left.pixelCount} and ${right.pixelCount}.`,
		);
	}
}

function footprintFromWords(
	pixelCount: number,
	words: readonly number[],
): PortalModelFootprint {
	const footprint = Object.freeze({
		pixelCount,
		words: Object.freeze(words.map((word) => word >>> 0)),
	});
	validateFootprint(footprint);
	return footprint;
}

function uniqueById<Item extends { readonly id: string }>(
	items: readonly Item[],
	kind: string,
): ReadonlyMap<Item["id"], Item> {
	const byId = new Map<Item["id"], Item>();
	for (const item of items) {
		if (byId.has(item.id)) {
			throw new Error(`Portal model repeats ${kind} id ${item.id}.`);
		}
		byId.set(item.id, item);
	}
	return byId;
}

function validateAperture(
	aperture: PortalModelAperture,
	pixelCount: number,
	crossingId: PortalModelCrossingId,
): void {
	validateFootprint(aperture.footprint);
	if (
		aperture.footprint.pixelCount !== pixelCount ||
		aperture.depthByPixel.length !== pixelCount
	) {
		throw new Error(
			`Portal model crossing ${crossingId} aperture does not match the ${pixelCount}-pixel screen.`,
		);
	}
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const brandedPixel = portalModelPixel(pixel, pixelCount);
		const covered = portalModelFootprintHas(aperture.footprint, brandedPixel);
		const depth = aperture.depthByPixel[pixel];
		if (covered !== (depth !== null)) {
			throw new Error(
				`Portal model crossing ${crossingId} aperture coverage and depth disagree at pixel ${pixel}.`,
			);
		}
		if (depth !== null) portalModelDepth(depth);
	}
}

function validateLocalDepthTies(scene: PortalModelScene): void {
	const eventsByScopePixel = new Map<string, Map<number, string>>();
	const addEvent = (
		scopeId: PortalModelScopeId,
		pixel: PortalModelPixel,
		depth: PortalModelDepth,
		identity: string,
	): void => {
		const key = `${scopeId}:${pixel}`;
		let eventByDepth = eventsByScopePixel.get(key);
		if (!eventByDepth) {
			eventByDepth = new Map<number, string>();
			eventsByScopePixel.set(key, eventByDepth);
		}
		const previous = eventByDepth.get(depth);
		if (previous) {
			throw new Error(
				`Portal model depth tie at scope ${scopeId}, pixel ${pixel}, depth ${depth}: ${previous} and ${identity}.`,
			);
		}
		eventByDepth.set(depth, identity);
	};

	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			addEvent(fragment.scopeId, fragment.pixel, fragment.depth, fragment.id);
		}
	}
	for (const crossing of scene.crossings) {
		for (let pixel = 0; pixel < scene.pixelCount; pixel += 1) {
			const depth = crossing.aperture.depthByPixel[pixel];
			if (depth === null) continue;
			addEvent(
				crossing.sourceScopeId,
				portalModelPixel(pixel, scene.pixelCount),
				depth,
				crossing.id,
			);
		}
	}
}
