import type { SceneInterestRevision } from "../../runtime/scene-availability";
import type { AssetTextureSource } from "../texture-manager";
import type { TexturePreparer } from "../texture-preparer";
import {
	assetTextureKeyMatchesSource,
	isPackedObjectTexturePurpose,
	texturePurposePolicy,
	type AssetTextureFact,
	type AssetTextureKey,
	type TexturePixelFormat,
} from "../types";

/** Exact owner/revision requirement handle; callers retain it for activation or stale cleanup. */
export interface AtlasRequirementHandle<TOwner extends string> {
	readonly owner: TOwner;
	readonly revision: SceneInterestRevision;
	/** Settles when this revision is ready, withdrawn, or fails preparation. */
	readonly completion: Promise<AtlasRequirementCompletion>;
}

/** Terminal outcome for one exact owner/revision source requirement. */
export type AtlasRequirementCompletion = "ready" | "withdrawn" | "failed";

/** Resource-free resident-atlas facts used by the Phase 2 lifecycle fixture. */
export interface ResidentTextureAtlasDiagnostics {
	readonly claimedTextureCount: number;
	readonly pendingRequirementCount: number;
	readonly publishedOwnerCount: number;
	readonly residentSourceBytes: number;
	readonly residentSourceCount: number;
}

interface Requirement<TOwner extends string> {
	readonly facts: readonly AssetTextureFact[];
	readonly handle: AtlasRequirementHandle<TOwner>;
	readonly resolve: (result: AtlasRequirementCompletion) => void;
	state: "preparing" | "ready" | "withdrawn" | "failed";
}

/**
 * Sole authority for revision-scoped object-atlas claims and retained prepared sources.
 *
 * Phase 2 readiness means that every claimed logical source is retained and validated. Phase 3
 * extends the same completion boundary through physical page publication before resolving ready.
 */
export class ResidentTextureAtlas<TOwner extends string> {
	readonly #preparer: TexturePreparer;
	/** Owner/revision claim sets, kept private so stale cleanup stays exact. */
	readonly #requirements = new Map<
		TOwner,
		Map<SceneInterestRevision, Requirement<TOwner>>
	>();
	/** The one active visible revision per owner, if any. */
	readonly #publishedRevisions = new Map<TOwner, SceneInterestRevision>();
	/** Every owner/revision currently requiring a logical source. */
	readonly #claimsByKey = new Map<AssetTextureKey, Set<Requirement<TOwner>>>();
	/** Validated CPU sources retained while at least one exact claim exists. */
	readonly #sources = new Map<AssetTextureKey, AssetTextureSource>();
	/** In-flight source preparations coalesced before a source becomes resident. */
	readonly #pendingSources = new Map<
		AssetTextureKey,
		Promise<AssetTextureSource>
	>();
	#destroyed = false;

	constructor(preparer: TexturePreparer) {
		this.#preparer = preparer;
	}

	/**
	 * Provisionally claim a complete logical requirement set. Identical repeated preparation returns
	 * the original handle; conflicting facts for one owner/revision fail before any mutation.
	 */
	prepareOwnerRequirements(
		owner: TOwner,
		revision: SceneInterestRevision,
		facts: readonly AssetTextureFact[],
	): AtlasRequirementHandle<TOwner> {
		if (this.#destroyed)
			throw new Error("Resident texture atlas is destroyed.");
		const normalizedFacts = normalizeFacts(facts);
		const ownerRequirements = this.#requirements.get(owner);
		const existing = ownerRequirements?.get(revision);
		if (existing) {
			if (!factsMatch(existing.facts, normalizedFacts)) {
				throw new Error(
					`Atlas owner ${owner} revision ${revision} has conflicting texture facts.`,
				);
			}
			return existing.handle;
		}

		let resolve!: (result: AtlasRequirementCompletion) => void;
		const completion = new Promise<AtlasRequirementCompletion>((accept) => {
			resolve = accept;
		});
		const handle: AtlasRequirementHandle<TOwner> = {
			completion,
			owner,
			revision,
		};
		const requirement: Requirement<TOwner> = {
			facts: normalizedFacts,
			handle,
			resolve,
			state: "preparing",
		};
		const requirements =
			ownerRequirements ??
			new Map<SceneInterestRevision, Requirement<TOwner>>();
		if (!ownerRequirements) this.#requirements.set(owner, requirements);
		requirements.set(revision, requirement);
		for (const fact of normalizedFacts) this.#addClaim(fact.key, requirement);
		void this.#prepareRequirement(requirement);
		return handle;
	}

	/** Activate a source-ready revision and withdraw the older visible revision for this owner only. */
	activateOwnerRevision(handle: AtlasRequirementHandle<TOwner>): void {
		const requirement = this.#requireExact(handle);
		if (requirement.state !== "ready") {
			throw new Error(
				`Atlas owner ${handle.owner} revision ${handle.revision} is not ready to activate.`,
			);
		}
		const publishedRevision = this.#publishedRevisions.get(handle.owner);
		if (publishedRevision === handle.revision) return;
		this.#publishedRevisions.set(handle.owner, handle.revision);
		if (publishedRevision !== undefined) {
			this.#withdrawExact(handle.owner, publishedRevision);
		}
	}

	/** Idempotently withdraw exactly one provisional or published owner/revision claim. */
	withdrawOwnerRevision(handle: AtlasRequirementHandle<TOwner>): void {
		this.#withdrawExact(handle.owner, handle.revision);
	}

	/**
	 * Authoritative eviction may withdraw the exact evicted revision and an older visible revision,
	 * but never a revision published by a later dispatch for the same owner.
	 */
	evictOwnerRequirements(
		owner: TOwner,
		evictedRevision: SceneInterestRevision,
	): void {
		const publishedRevision = this.#publishedRevisions.get(owner);
		if (
			publishedRevision !== undefined &&
			publishedRevision <= evictedRevision
		) {
			this.#withdrawExact(owner, publishedRevision);
		}
		this.#withdrawExact(owner, evictedRevision);
	}

	/** Read one retained source for the later page-build transaction; absent sources are not ready. */
	getPreparedSource(key: AssetTextureKey): AssetTextureSource {
		const source = this.#sources.get(key);
		if (!source)
			throw new Error(
				`Resident texture ${key} has no retained prepared source.`,
			);
		return source;
	}

	/** Return resource-free source and claim lifetime facts. */
	getDiagnostics(): ResidentTextureAtlasDiagnostics {
		return {
			claimedTextureCount: this.#claimsByKey.size,
			pendingRequirementCount: [...this.#requirements.values()].reduce(
				(total, requirements) =>
					total +
					[...requirements.values()].filter(
						(requirement) => requirement.state === "preparing",
					).length,
				0,
			),
			publishedOwnerCount: this.#publishedRevisions.size,
			residentSourceBytes: [...this.#sources.values()].reduce(
				(total, source) => total + source.pixels.byteLength,
				0,
			),
			residentSourceCount: this.#sources.size,
		};
	}

	/** Withdraw every exact claim without destroying the shared texture preparer. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const [owner, requirements] of [...this.#requirements]) {
			for (const revision of [...requirements.keys()])
				this.#withdrawExact(owner, revision);
		}
		this.#sources.clear();
		this.#pendingSources.clear();
	}

	async #prepareRequirement(requirement: Requirement<TOwner>): Promise<void> {
		try {
			await Promise.all(
				requirement.facts.map((fact) => this.#prepareSource(fact)),
			);
			if (requirement.state !== "preparing") return;
			requirement.state = "ready";
			requirement.resolve("ready");
		} catch {
			if (requirement.state !== "preparing") return;
			this.#withdrawExact(
				requirement.handle.owner,
				requirement.handle.revision,
				"failed",
			);
		}
	}

	#prepareSource(fact: AssetTextureFact): Promise<AssetTextureSource> {
		const resident = this.#sources.get(fact.key);
		if (resident) return Promise.resolve(resident);
		const pending = this.#pendingSources.get(fact.key);
		if (pending) return pending;
		const preparation = this.#preparer
			.prepare(fact)
			.then((source) => {
				validatePreparedSource(fact, source);
				if (this.#claimsByKey.has(fact.key))
					this.#sources.set(fact.key, source);
				return source;
			})
			.finally(() => this.#pendingSources.delete(fact.key));
		this.#pendingSources.set(fact.key, preparation);
		return preparation;
	}

	#addClaim(key: AssetTextureKey, requirement: Requirement<TOwner>): void {
		const claims = this.#claimsByKey.get(key) ?? new Set<Requirement<TOwner>>();
		claims.add(requirement);
		this.#claimsByKey.set(key, claims);
	}

	#withdrawExact(
		owner: TOwner,
		revision: SceneInterestRevision,
		completion: Exclude<AtlasRequirementCompletion, "ready"> = "withdrawn",
	): void {
		const requirement = this.#requirements.get(owner)?.get(revision);
		if (!requirement || requirement.state === "withdrawn") return;
		if (this.#publishedRevisions.get(owner) === revision) {
			this.#publishedRevisions.delete(owner);
		}
		const requirements = this.#requirements.get(owner)!;
		requirements.delete(revision);
		if (requirements.size === 0) this.#requirements.delete(owner);
		for (const fact of requirement.facts) {
			const claims = this.#claimsByKey.get(fact.key);
			if (!claims)
				throw new Error(`Resident texture ${fact.key} lost its claim index.`);
			claims.delete(requirement);
			if (claims.size === 0) {
				this.#claimsByKey.delete(fact.key);
				this.#sources.delete(fact.key);
			}
		}
		if (requirement.state === "preparing") requirement.resolve(completion);
		requirement.state = completion;
	}

	#requireExact(handle: AtlasRequirementHandle<TOwner>): Requirement<TOwner> {
		const requirement = this.#requirements
			.get(handle.owner)
			?.get(handle.revision);
		if (!requirement || requirement.handle !== handle) {
			throw new Error(
				`Atlas owner ${handle.owner} revision ${handle.revision} is not an active requirement.`,
			);
		}
		return requirement;
	}
}

function normalizeFacts(
	facts: readonly AssetTextureFact[],
): readonly AssetTextureFact[] {
	const factsByKey = new Map<AssetTextureKey, AssetTextureFact>();
	for (const fact of facts) {
		if (!isPackedObjectTexturePurpose(fact.purpose)) {
			throw new Error(
				`Texture purpose ${fact.purpose} is not supported by the resident object atlas.`,
			);
		}
		if (
			!assetTextureKeyMatchesSource(fact.key, fact.purpose, fact.sourceAssetId)
		) {
			throw new Error(
				`Atlas texture fact ${fact.key} does not match its source identity.`,
			);
		}
		const existing = factsByKey.get(fact.key);
		if (existing && !factMatches(existing, fact)) {
			throw new Error(
				`Atlas texture fact ${fact.key} has conflicting source identity.`,
			);
		}
		factsByKey.set(fact.key, fact);
	}
	return [...factsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function factsMatch(
	left: readonly AssetTextureFact[],
	right: readonly AssetTextureFact[],
): boolean {
	return (
		left.length === right.length &&
		left.every((fact, index) => factMatches(fact, right[index]!))
	);
}

function factMatches(left: AssetTextureFact, right: AssetTextureFact): boolean {
	return (
		left.key === right.key &&
		left.purpose === right.purpose &&
		left.sourceAssetId === right.sourceAssetId
	);
}

function validatePreparedSource(
	fact: AssetTextureFact,
	source: Awaited<ReturnType<TexturePreparer["prepare"]>>,
): asserts source is AssetTextureSource {
	if ("layers" in source)
		throw new Error(`Texture preparer returned array data for ${fact.key}.`);
	if (
		source.key !== fact.key ||
		source.purpose !== fact.purpose ||
		source.sourceAssetId !== fact.sourceAssetId
	) {
		throw new Error(
			`Texture preparer returned incompatible source for ${fact.key}.`,
		);
	}
	if (
		!Number.isInteger(source.width) ||
		source.width <= 0 ||
		!Number.isInteger(source.height) ||
		source.height <= 0
	) {
		throw new Error(
			`Texture preparer returned invalid dimensions for ${fact.key}.`,
		);
	}
	const expectedBytes =
		source.width *
		source.height *
		bytesPerPixel(fact.key, texturePurposePolicy(fact.purpose).format);
	if (source.pixels.byteLength !== expectedBytes) {
		throw new Error(
			`Texture preparer returned invalid pixel length for ${fact.key}.`,
		);
	}
}

function bytesPerPixel(
	key: AssetTextureKey,
	format: TexturePixelFormat,
): number {
	switch (format) {
		case "rgba8":
			return 4;
		case "r8":
		case "a8":
			return 1;
		case "rg8":
			return 2;
		default:
			throw new Error(
				`Atlas texture ${key} has unsupported pixel format ${format}.`,
			);
	}
}
