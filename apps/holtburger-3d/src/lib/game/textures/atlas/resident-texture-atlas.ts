import type { ClosedWorkerPoolDiagnostics } from "../../workers/closed-worker";
import type {
	RendererResourceManager,
	Texture2DResourceKey,
} from "../../renderer/resource-manager";
import type {
	AssetTextureSource,
	TextureAtlasPageDiagnostics,
	TextureAtlasBinding,
	TextureManagerDiagnostics,
} from "../texture-manager";
import type { TexturePreparer } from "../texture-preparer";
import {
	assetTextureKeyMatchesSource,
	isPackedObjectTexturePurpose,
	texturePixelFormatByteLength,
	texturePurposePolicy,
	type AssetTextureFact,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
} from "../types";
import {
	allocationBoundsForPlacement,
	type AtlasPageLayout,
	type AtlasPlacement,
	type StableAtlasLayoutPlan,
	type StableAtlasLayoutRequest,
} from "./layout";
import type {
	AtlasPageBuildJob,
	AtlasPageBuildResult,
	AtlasPagePatchJob,
	AtlasPagePatchResult,
} from "./page-build";
import {
	AtlasPagePublication,
	type AtlasPagePublicationDiagnostics,
} from "./page-publication";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";

/** Exact owner/revision requirement handle; callers retain it for activation or stale cleanup. */
export interface AtlasRequirementHandle<TOwner extends string> {
	readonly owner: TOwner;
	/** Exact owner-local revision; the atlas does not interpret the producer's revision domain. */
	readonly revision: number;
	/** Settles when this revision is ready, withdrawn, or fails preparation. */
	readonly completion: Promise<AtlasRequirementCompletion>;
}

/** Terminal outcome for one exact owner/revision source requirement. */
export type AtlasRequirementCompletion =
	| "ready"
	| "withdrawn"
	/** A preparation or page-publication error retained only until runtime logging. */
	| { readonly kind: "failed"; readonly cause: unknown };

/** Resource-free resident-atlas facts used by the Phase 2 lifecycle fixture. */
export interface ResidentTextureAtlasDiagnostics {
	readonly activePageCount: number;
	readonly activePageBytes: number;
	readonly peakPageBytes: number;
	readonly acceptedCompactionCount: number;
	readonly avoidedPreparationCount: number;
	readonly claimedTextureCount: number;
	/** Compaction plans actually computed; layouts that cannot shrink are never planned. */
	readonly compactionAttemptCount: number;
	readonly copiedSourceBytes: number;
	readonly eliminatedPageCount: number;
	readonly failedCompactionCount: number;
	readonly insertedReuseCount: number;
	/** Release-only page updates that swapped placement metadata without a rebuild. */
	readonly metadataOnlyPageUpdateCount: number;
	/** Pages patched in place instead of rebuilt. */
	readonly patchedPageCount: number;
	/** Level-zero region bytes written into retained page resources. */
	readonly patchedRegionBytes: number;
	/** Publications that retried as whole-page rebuilds after a patch attempt failed. */
	readonly patchFallbackCount: number;
	readonly uploadedPageBytes: number;
	readonly uploadedPageCount: number;
	readonly releasedPageBytes: number;
	readonly releasedPageCount: number;
	readonly failedTransactionCount: number;
	readonly staleTransactionCount: number;
	readonly publicationDurationMs: number;
	readonly longestPublicationDurationMs: number;
	readonly layoutWorker: ClosedWorkerPoolDiagnostics | null;
	readonly pageBuildWorker: ClosedWorkerPoolDiagnostics | null;
	readonly pendingRequirementCount: number;
	readonly publishedOwnerCount: number;
	readonly residentSourceBytes: number;
	readonly residentSourceCount: number;
}

/** Narrow closed-worker layout port; resident state never crosses this boundary. */
export interface ResidentAtlasLayoutPlanner {
	plan(request: StableAtlasLayoutRequest): Promise<StableAtlasLayoutPlan>;
	getDiagnostics?(): ClosedWorkerPoolDiagnostics;
	destroy(): void;
}

/** Narrow closed-worker page-build port; callers transfer copies rather than retained sources. */
export interface ResidentAtlasPageBuilder {
	build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult>;
	patch(
		job: AtlasPagePatchJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPagePatchResult>;
	getDiagnostics?(): ClosedWorkerPoolDiagnostics;
	destroy(): void;
}

/** Physical publication dependencies owned by the runtime resident-atlas authority. */
export interface ResidentTextureAtlasPhysicalDependencies {
	readonly layoutPlanner: ResidentAtlasLayoutPlanner;
	readonly pageBuilder: ResidentAtlasPageBuilder;
	readonly renderResources: RendererResourceManager;
	/** Test-only fixture override; production pages retain the fixed 2048px policy. */
	readonly pageSize?: number;
	/**
	 * Called after a publication changes a surviving binding's resource or placement facts.
	 *
	 * Compaction and whole-page replacement invalidate cached bindings. Insertions and releases
	 * that leave surviving bindings unchanged do not. The publication owns this distinction.
	 */
	readonly onRetainedBindingsChanged?: () => void;
}

interface Requirement<TOwner extends string> {
	readonly facts: readonly PackedAssetTextureFact[];
	readonly handle: AtlasRequirementHandle<TOwner>;
	readonly resolve: (result: AtlasRequirementCompletion) => void;
	state: "preparing" | "ready" | "withdrawn" | "failed";
}

/** Fact constrained to the four purposes admitted by this resident atlas. */
type PackedAssetTextureFact = AssetTextureFact & {
	readonly purpose: PackedObjectTexturePurpose;
};

/** Stable and compact layout candidates for one unchanged purpose epoch. */
interface PurposeRebuildPlans {
	readonly compact: StableAtlasLayoutPlan | null;
	readonly epoch: number;
	readonly nextPageGeneration: number;
	readonly stable: StableAtlasLayoutPlan;
	readonly stableNewPageCount: number;
}

/**
 * Sole authority for revision-scoped object-atlas claims and retained prepared sources.
 *
 * Phase 2 readiness means that every claimed logical source is retained and validated. Phase 3
 * extends the same completion boundary through physical page publication before resolving ready.
 */
export class ResidentTextureAtlas<TOwner extends string> {
	readonly #preparer: TexturePreparer;
	readonly #physical: ResidentTextureAtlasPhysicalDependencies | null;
	/** Owner/revision claim sets, kept private so stale cleanup stays exact. */
	readonly #requirements = new Map<TOwner, Map<number, Requirement<TOwner>>>();
	/** The one active visible revision per owner, if any. */
	readonly #publishedRevisions = new Map<TOwner, number>();
	/** Every owner/revision currently requiring a logical source. */
	readonly #claimsByKey = new Map<AssetTextureKey, Set<Requirement<TOwner>>>();
	/** Validated CPU sources retained while at least one exact claim exists. */
	readonly #sources = new Map<AssetTextureKey, AssetTextureSource>();
	/** In-flight source preparations coalesced before a source becomes resident. */
	readonly #pendingSources = new Map<
		AssetTextureKey,
		Promise<AssetTextureSource>
	>();
	/** Device-page state isolated from claim, source, and currentness state. */
	readonly #publication: AtlasPagePublication | null;
	readonly #purposeLanes = new Map<PackedObjectTexturePurpose, Promise<void>>();
	readonly #purposeEpochs = new Map<PackedObjectTexturePurpose, number>();
	readonly #publishedPurposeEpochs = new Map<
		PackedObjectTexturePurpose,
		number
	>();
	readonly #nextPageGeneration = new Map<PackedObjectTexturePurpose, number>();
	#copiedSourceBytes = 0;
	#failedTransactionCount = 0;
	#staleTransactionCount = 0;
	#avoidedPreparationCount = 0;
	#compactionAttemptCount = 0;
	#acceptedCompactionCount = 0;
	#failedCompactionCount = 0;
	#eliminatedPageCount = 0;
	#insertedReuseCount = 0;
	/** Pages whose placement change was release-only and needed no pixel or GPU work. */
	#metadataOnlyPageUpdateCount = 0;
	/** Publications that retried as whole-page rebuilds after a patch attempt failed. */
	#patchFallbackCount = 0;
	#destroyed = false;
	/** The fixture override resolved against fixed policy once, so no caller re-resolves it. */
	readonly #pageSize: number;

	constructor(
		preparer: TexturePreparer,
		physical: ResidentTextureAtlasPhysicalDependencies | null = null,
	) {
		this.#preparer = preparer;
		this.#physical = physical;
		this.#pageSize =
			physical?.pageSize ??
			SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize;
		this.#publication =
			physical === null
				? null
				: new AtlasPagePublication(physical.renderResources, this.#pageSize);
	}

	/**
	 * Provisionally claim a complete logical requirement set. Identical repeated preparation returns
	 * the original handle; conflicting facts for one owner/revision fail before any mutation.
	 */
	prepareOwnerRequirements<TRequestedOwner extends TOwner>(
		owner: TRequestedOwner,
		revision: number,
		facts: readonly AssetTextureFact[],
	): AtlasRequirementHandle<TRequestedOwner>;
	prepareOwnerRequirements(
		owner: TOwner,
		revision: number,
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
		let requirements = ownerRequirements;
		if (!requirements) {
			requirements = new Map<number, Requirement<TOwner>>();
			this.#requirements.set(owner, requirements);
		}
		requirements.set(revision, requirement);
		for (const fact of normalizedFacts) this.#addClaim(fact, requirement);
		void this.#prepareRequirement(requirement);
		return handle;
	}

	/** Activate a source-ready revision and withdraw the older visible revision for this owner only. */
	async activateOwnerRevision(
		handle: AtlasRequirementHandle<TOwner>,
	): Promise<void> {
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
			const retiredPurposes = this.#withdrawExact(
				handle.owner,
				publishedRevision,
			);
			const failedTransactionsBeforeCleanup = this.#failedTransactionCount;
			try {
				await this.#synchronizePurposes(retiredPurposes);
			} catch {
				if (this.#failedTransactionCount === failedTransactionsBeforeCleanup) {
					this.#failedTransactionCount += 1;
				}
				// The replacement is already the logical and visible revision. The failed physical
				// rebuild remains dirty and is reported by failedTransactionCount; later ordinary
				// atlas synchronization may finish reclaiming the retired revision's page space.
			}
		}
	}

	/** Idempotently withdraw exactly one provisional or published owner/revision claim. */
	withdrawOwnerRevision(handle: AtlasRequirementHandle<TOwner>): Promise<void> {
		return this.#synchronizePurposes(
			this.#withdrawExact(handle.owner, handle.revision),
		);
	}

	/**
	 * Authoritative eviction may withdraw the exact evicted revision and an older visible revision,
	 * but never a revision published by a later dispatch for the same owner.
	 */
	async evictOwnerRequirements(
		owner: TOwner,
		evictedRevision: number,
	): Promise<void> {
		const affectedPurposes: PackedObjectTexturePurpose[] = [];
		const publishedRevision = this.#publishedRevisions.get(owner);
		if (
			publishedRevision !== undefined &&
			publishedRevision <= evictedRevision
		) {
			affectedPurposes.push(...this.#withdrawExact(owner, publishedRevision));
		}
		affectedPurposes.push(...this.#withdrawExact(owner, evictedRevision));
		await this.#synchronizePurposes(affectedPurposes);
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

	/** Return the current physical binding for one ready resident logical texture. */
	getAtlasBinding(key: AssetTextureKey): TextureAtlasBinding | null {
		return this.#publication?.getBinding(key) ?? null;
	}

	/** Return one current page resource without exposing retained page pixels. */
	getAtlasPageResource(pageId: `page:${string}`): Texture2DResourceKey | null {
		return this.#publication?.getPageResource(pageId) ?? null;
	}

	/** Return resource-free source and claim lifetime facts. */
	getDiagnostics(): ResidentTextureAtlasDiagnostics {
		const publication = this.#publicationDiagnostics();
		return {
			activePageCount: publication.activePageCount,
			activePageBytes: publication.activePageBytes,
			peakPageBytes: publication.peakPageBytes,
			acceptedCompactionCount: this.#acceptedCompactionCount,
			avoidedPreparationCount: this.#avoidedPreparationCount,
			claimedTextureCount: this.#claimsByKey.size,
			compactionAttemptCount: this.#compactionAttemptCount,
			copiedSourceBytes: this.#copiedSourceBytes,
			eliminatedPageCount: this.#eliminatedPageCount,
			failedCompactionCount: this.#failedCompactionCount,
			insertedReuseCount: this.#insertedReuseCount,
			metadataOnlyPageUpdateCount: this.#metadataOnlyPageUpdateCount,
			patchedPageCount: publication.patchedPageCount,
			patchedRegionBytes: publication.patchedRegionBytes,
			patchFallbackCount: this.#patchFallbackCount,
			uploadedPageBytes: publication.uploadedPageBytes,
			uploadedPageCount: publication.uploadedPageCount,
			releasedPageBytes: publication.releasedPageBytes,
			releasedPageCount: publication.releasedPageCount,
			failedTransactionCount: this.#failedTransactionCount,
			staleTransactionCount: this.#staleTransactionCount,
			publicationDurationMs: publication.publicationDurationMs,
			longestPublicationDurationMs: publication.longestPublicationDurationMs,
			layoutWorker: this.#physical?.layoutPlanner.getDiagnostics?.() ?? null,
			pageBuildWorker: this.#physical?.pageBuilder.getDiagnostics?.() ?? null,
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

	/** Adapt resident facts to the generic texture facade. */
	getAtlasDiagnostics(): TextureManagerDiagnostics {
		const diagnostics = this.getDiagnostics();
		return {
			activeAtlasPages: diagnostics.activePageCount,
			activeAtlasPageBytes: diagnostics.activePageBytes,
			peakAtlasPageBytes: diagnostics.peakPageBytes,
			acceptedAtlasCompactions: diagnostics.acceptedCompactionCount,
			attemptedAtlasCompactions: diagnostics.compactionAttemptCount,
			avoidedAtlasPreparations: diagnostics.avoidedPreparationCount,
			compactedAtlasPagesEliminated: diagnostics.eliminatedPageCount,
			failedAtlasCompactions: diagnostics.failedCompactionCount,
			copiedAtlasSourceBytes: diagnostics.copiedSourceBytes,
			uploadedAtlasPageBytes: diagnostics.uploadedPageBytes,
			uploadedAtlasPages: diagnostics.uploadedPageCount,
			releasedAtlasPageBytes: diagnostics.releasedPageBytes,
			releasedAtlasPages: diagnostics.releasedPageCount,
			failedAtlasTransactions: diagnostics.failedTransactionCount,
			staleAtlasTransactions: diagnostics.staleTransactionCount,
			atlasPublicationDurationMs: diagnostics.publicationDurationMs,
			longestAtlasPublicationDurationMs:
				diagnostics.longestPublicationDurationMs,
			atlasLayoutWorker: diagnostics.layoutWorker,
			atlasPageBuildWorker: diagnostics.pageBuildWorker,
			pendingAtlasRequirements: diagnostics.pendingRequirementCount,
			residentAtlasBindings: this.#publicationDiagnostics().bindingCount,
			residentSourceBytes: diagnostics.residentSourceBytes,
			residentSourceCount: diagnostics.residentSourceCount,
			reusedAtlasInsertions: diagnostics.insertedReuseCount,
			metadataOnlyAtlasPageUpdates: diagnostics.metadataOnlyPageUpdateCount,
			patchedAtlasPages: diagnostics.patchedPageCount,
			patchedAtlasRegionBytes: diagnostics.patchedRegionBytes,
			atlasPatchFallbacks: diagnostics.patchFallbackCount,
		};
	}

	/** Expose page placement facts for Explorer inspection; every entry is live resident state. */
	getAtlasPageDiagnostics(): readonly TextureAtlasPageDiagnostics[] {
		return this.#publication?.getPageDiagnostics() ?? [];
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
		this.#destroyPhysicalFixture();
	}

	async #prepareRequirement(requirement: Requirement<TOwner>): Promise<void> {
		try {
			await Promise.all(
				requirement.facts.map((fact) => this.#prepareSource(fact)),
			);
			if (requirement.state !== "preparing") return;
			await this.#ensureRequirementBindings(requirement);
			if (requirement.state !== "preparing") return;
			requirement.state = "ready";
			requirement.resolve("ready");
		} catch (cause) {
			if (requirement.state !== "preparing") return;
			this.#withdrawExact(
				requirement.handle.owner,
				requirement.handle.revision,
				{ cause, kind: "failed" },
			);
		}
	}

	#prepareSource(fact: PackedAssetTextureFact): Promise<AssetTextureSource> {
		const resident = this.#sources.get(fact.key);
		if (resident) {
			this.#avoidedPreparationCount += 1;
			return Promise.resolve(resident);
		}
		const pending = this.#pendingSources.get(fact.key);
		if (pending) {
			this.#avoidedPreparationCount += 1;
			return pending;
		}
		const preparation = this.#preparer
			.prepare(fact)
			.then((source) => {
				validatePreparedSource(fact, source);
				if (this.#claimsByKey.has(fact.key)) {
					this.#sources.set(fact.key, source);
					this.#markPurposeDirty(fact.purpose);
				}
				return source;
			})
			.finally(() => this.#pendingSources.delete(fact.key));
		this.#pendingSources.set(fact.key, preparation);
		return preparation;
	}

	#addClaim(
		fact: PackedAssetTextureFact,
		requirement: Requirement<TOwner>,
	): void {
		const claims =
			this.#claimsByKey.get(fact.key) ?? new Set<Requirement<TOwner>>();
		claims.add(requirement);
		this.#claimsByKey.set(fact.key, claims);
	}

	#withdrawExact(
		owner: TOwner,
		revision: number,
		completion: Exclude<AtlasRequirementCompletion, "ready"> = "withdrawn",
	): readonly PackedObjectTexturePurpose[] {
		const requirement = this.#requirements.get(owner)?.get(revision);
		if (!requirement || requirement.state === "withdrawn") return [];
		if (this.#publishedRevisions.get(owner) === revision) {
			this.#publishedRevisions.delete(owner);
		}
		const requirements = this.#requirements.get(owner)!;
		requirements.delete(revision);
		if (requirements.size === 0) this.#requirements.delete(owner);
		const affectedPurposes = this.#releaseRequirementClaims(requirement);
		if (requirement.state === "preparing") requirement.resolve(completion);
		requirement.state = completion === "withdrawn" ? "withdrawn" : "failed";
		return affectedPurposes;
	}

	#releaseRequirementClaims(
		requirement: Requirement<TOwner>,
	): readonly PackedObjectTexturePurpose[] {
		const affectedPurposes = new Set<PackedObjectTexturePurpose>();
		for (const fact of requirement.facts) {
			affectedPurposes.add(fact.purpose);
			const claims = this.#claimsByKey.get(fact.key);
			if (!claims)
				throw new Error(`Resident texture ${fact.key} lost its claim index.`);
			claims.delete(requirement);
			if (claims.size !== 0) continue;
			this.#claimsByKey.delete(fact.key);
			this.#sources.delete(fact.key);
			this.#markPurposeDirty(fact.purpose);
		}
		return [...affectedPurposes];
	}

	async #ensureRequirementBindings(
		requirement: Requirement<TOwner>,
	): Promise<void> {
		if (this.#physical === null) return;
		const purposes = new Set(requirement.facts.map((fact) => fact.purpose));
		for (const purpose of purposes) {
			while (requirement.state === "preparing") {
				await this.#synchronizePurpose(purpose);
				if (
					requirement.facts
						.filter((fact) => fact.purpose === purpose)
						.every((fact) => this.#publication?.getBinding(fact.key) !== null)
				) {
					break;
				}
			}
		}
	}

	async #synchronizePurposes(
		purposes: readonly PackedObjectTexturePurpose[],
	): Promise<void> {
		if (this.#physical === null) return;
		await Promise.all(
			[...new Set(purposes)].map((purpose) =>
				this.#synchronizePurpose(purpose),
			),
		);
	}

	async #synchronizePurpose(
		purpose: PackedObjectTexturePurpose,
	): Promise<void> {
		if (this.#physical === null || this.#destroyed) return;
		while (
			this.#publishedPurposeEpochs.get(purpose) !==
			this.#purposeEpochs.get(purpose)
		) {
			await this.#enqueuePurposeRebuild(purpose);
		}
	}

	#enqueuePurposeRebuild(purpose: PackedObjectTexturePurpose): Promise<void> {
		const previous = this.#purposeLanes.get(purpose) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(() => this.#rebuildPurpose(purpose));
		this.#purposeLanes.set(purpose, next);
		return next;
	}

	async #rebuildPurpose(purpose: PackedObjectTexturePurpose): Promise<void> {
		const plans = await this.#planPurposeRebuild(purpose);
		if (plans === null) return;
		if (plans.compact !== null) {
			this.#compactionAttemptCount += 1;
			if (
				shouldAcceptCompaction(
					plans.stable,
					plans.compact,
					SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas
						.maximumCompactionRebuildPages,
				) &&
				(await this.#tryPublishCompaction(purpose, plans.compact, plans))
			) {
				return;
			}
		}
		if (this.#physical === null) return;
		try {
			await this.#publishPlan(plans.stable);
		} catch (error) {
			this.#failedTransactionCount += 1;
			throw error;
		}
		this.#commitNextPageGeneration(
			purpose,
			plans.nextPageGeneration + plans.stableNewPageCount,
		);
		this.#markPurposePublished(purpose, plans.epoch);
	}

	async #planPurposeRebuild(
		purpose: PackedObjectTexturePurpose,
	): Promise<PurposeRebuildPlans | null> {
		const physical = this.#physical;
		if (physical === null || this.#destroyed) return null;
		const epoch = this.#purposeEpochs.get(purpose) ?? 0;
		const nextPageGeneration = this.#nextPageGeneration.get(purpose) ?? 0;
		const entries = [...this.#sources.values()]
			.filter((source) => source.purpose === purpose)
			.map((source) => ({
				height: source.height,
				key: source.key,
				purpose,
				width: source.width,
			}));
		const stable = await physical.layoutPlanner.plan({
			correlationId: `resident:${purpose}:${epoch}`,
			entries,
			nextPageGeneration,
			pages: this.#publication?.getPurposeLayouts(purpose) ?? [],
			purpose,
		});
		if (!this.#isPurposeCurrent(purpose, epoch)) return null;
		const stableNewPageCount = stable.pages.filter(
			(page) => !this.#publication?.hasPage(page.pageId),
		).length;
		// Planning a compaction costs a worker round trip, so only pay it when the layout could
		// arithmetically end up on fewer pages and still fit the rebuild budget. Both conditions
		// are necessary for `shouldAcceptCompaction`, so skipping cannot hide an accepted pass.
		const compact = couldCompactionReducePages(
			stable,
			this.#pageSize,
			SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas
				.maximumCompactionRebuildPages,
		)
			? await physical.layoutPlanner.plan({
					correlationId: `resident:${purpose}:${epoch}:compact`,
					entries,
					nextPageGeneration: nextPageGeneration + stableNewPageCount,
					pages: [],
					purpose,
				})
			: null;
		if (!this.#isPurposeCurrent(purpose, epoch)) return null;
		return { compact, epoch, nextPageGeneration, stable, stableNewPageCount };
	}

	async #tryPublishCompaction(
		purpose: PackedObjectTexturePurpose,
		compact: StableAtlasLayoutPlan,
		plans: PurposeRebuildPlans,
	): Promise<boolean> {
		try {
			await this.#publishPlan(compact);
		} catch {
			this.#failedCompactionCount += 1;
			this.#failedTransactionCount += 1;
			return false;
		}
		this.#commitNextPageGeneration(
			purpose,
			plans.nextPageGeneration +
				plans.stableNewPageCount +
				compact.pages.length,
		);
		if (!this.#markPurposePublished(purpose, plans.epoch)) return true;
		this.#acceptedCompactionCount += 1;
		this.#eliminatedPageCount +=
			plans.stable.pages.length - compact.pages.length;
		return true;
	}

	#isPurposeCurrent(
		purpose: PackedObjectTexturePurpose,
		epoch: number,
	): boolean {
		const current =
			!this.#destroyed && this.#purposeEpochs.get(purpose) === epoch;
		if (!current) this.#staleTransactionCount += 1;
		return current;
	}

	#markPurposePublished(
		purpose: PackedObjectTexturePurpose,
		epoch: number,
	): boolean {
		if (!this.#isPurposeCurrent(purpose, epoch)) return false;
		this.#publishedPurposeEpochs.set(purpose, epoch);
		return true;
	}

	/**
	 * Record page identities consumed by a successful physical publication independently of whether
	 * its logical source epoch is still current.
	 */
	#commitNextPageGeneration(
		purpose: PackedObjectTexturePurpose,
		nextPageGeneration: number,
	): void {
		const committed = this.#nextPageGeneration.get(purpose) ?? 0;
		if (nextPageGeneration < committed) {
			throw new Error(
				`Atlas page generation for ${purpose} regressed from ${committed} to ${nextPageGeneration}.`,
			);
		}
		this.#nextPageGeneration.set(purpose, nextPageGeneration);
	}

	async #publishPlan(plan: StableAtlasLayoutPlan): Promise<void> {
		const physical = this.#physical;
		const publication = this.#publication;
		if (physical === null || publication === null) {
			throw new Error(
				"Resident atlas cannot publish without physical publication state.",
			);
		}
		const published = new Map(
			publication
				.getPurposeLayouts(plan.purpose)
				.map((layout) => [layout.pageId, layout] as const),
		);
		const insertedKeys = new Set(plan.insertedKeys);
		const dispositions = plan.pages.map((page) => ({
			disposition: classifyAtlasPageDisposition(
				published.get(page.pageId),
				page,
				insertedKeys,
			),
			page,
		}));
		const existingPageIds = new Set(
			plan.pages
				.filter((page) => publication.hasPage(page.pageId))
				.map((page) => page.pageId),
		);
		const { built, patched, publishedDispositions } =
			await this.#preparePayloads(dispositions, physical);
		const retainedBindingsChanged = publication.publish(plan, {
			built,
			patched,
		});
		if (retainedBindingsChanged) physical.onRetainedBindingsChanged?.();
		// Counters commit only once the publication they describe has, so a failed attempt that
		// later falls back to whole pages is never counted as work that landed.
		this.#metadataOnlyPageUpdateCount += publishedDispositions.filter(
			({ disposition }) => disposition.kind === "metadata-only",
		).length;
		for (const key of plan.insertedKeys) {
			if (
				plan.pages.some(
					(page) =>
						existingPageIds.has(page.pageId) &&
						page.placements.some((placement) => placement.key === key),
				)
			) {
				this.#insertedReuseCount += 1;
			}
		}
	}

	/**
	 * Build every payload one publication needs, degrading patches to whole-page rebuilds if they
	 * cannot be composited.
	 *
	 * Only the patch jobs are retryable: a patch is an optimization over rebuilding, so its failure
	 * has a correct fallback. Every other failure — a lost retained source, a failed page build —
	 * is a real fault and propagates rather than being relabelled as patch trouble.
	 */
	async #preparePayloads(
		dispositions: readonly AtlasPageDispositionEntry[],
		physical: ResidentTextureAtlasPhysicalDependencies,
	): Promise<{
		readonly built: readonly AtlasPageBuildResult[];
		readonly patched: readonly AtlasPagePatchResult[];
		readonly publishedDispositions: readonly AtlasPageDispositionEntry[];
	}> {
		// Flattened rather than filtered so the inserted keys stay narrowed to the patch case.
		const patchEntries = dispositions.flatMap(({ disposition, page }) =>
			disposition.kind === "patch"
				? [{ insertedKeys: disposition.insertedKeys, page }]
				: [],
		);
		let patched: readonly AtlasPagePatchResult[] = [];
		let publishedDispositions = dispositions;
		if (patchEntries.length > 0) {
			try {
				patched = await Promise.all(
					patchEntries.map(({ insertedKeys: keys, page }) =>
						this.#patchPage(page, keys, physical),
					),
				);
			} catch {
				this.#patchFallbackCount += 1;
				patched = [];
				publishedDispositions = dispositions.map(({ disposition, page }) => ({
					disposition:
						disposition.kind === "patch"
							? ({ kind: "build" } as const)
							: disposition,
					page,
				}));
			}
		}
		const built = await Promise.all(
			publishedDispositions.flatMap(({ disposition, page }) =>
				disposition.kind === "build" ? [this.#buildPage(page, physical)] : [],
			),
		);
		return { built, patched, publishedDispositions };
	}

	async #patchPage(
		page: AtlasPageLayout,
		patchedKeys: readonly AssetTextureKey[],
		physical: ResidentTextureAtlasPhysicalDependencies,
	): Promise<AtlasPagePatchResult> {
		const sources = this.#copyPageSources(patchedKeys, page);
		const transfer = sources.map(
			(source) => source.pixels.buffer as ArrayBuffer,
		);
		const result = await physical.pageBuilder.patch(
			{ page, pageSize: this.#pageSize, patchedKeys, sources },
			transfer,
		);
		this.#copiedSourceBytes += result.copiedSourceBytes;
		return result;
	}

	async #buildPage(
		page: AtlasPageLayout,
		physical: ResidentTextureAtlasPhysicalDependencies,
	): Promise<AtlasPageBuildResult> {
		const sources = this.#copyPageSources(
			page.placements.map((placement) => placement.key),
			page,
		);
		const transfer = sources.map(
			(source) => source.pixels.buffer as ArrayBuffer,
		);
		const result = await physical.pageBuilder.build(
			{ page, pageSize: this.#pageSize, sources },
			transfer,
		);
		this.#copiedSourceBytes += result.copiedSourceBytes;
		return result;
	}

	/** Copy retained source pixels for one page job; retained sources are never transferred. */
	#copyPageSources(
		keys: readonly AssetTextureKey[],
		page: AtlasPageLayout,
	): AtlasPageBuildJob["sources"] {
		return keys.map((key) => {
			const source = this.#sources.get(key);
			if (!source) {
				throw new Error(
					`Resident atlas page ${page.pageId} lost retained source ${key}.`,
				);
			}
			return {
				height: source.height,
				key: source.key,
				pixels: source.pixels.slice(),
				width: source.width,
			};
		});
	}

	#markPurposeDirty(purpose: PackedObjectTexturePurpose): void {
		this.#purposeEpochs.set(
			purpose,
			(this.#purposeEpochs.get(purpose) ?? 0) + 1,
		);
	}

	#destroyPhysicalFixture(): void {
		const physical = this.#physical;
		if (physical === null) return;
		this.#publication?.destroy();
		physical.layoutPlanner.destroy();
		physical.pageBuilder.destroy();
	}

	#publicationDiagnostics(): AtlasPagePublicationDiagnostics {
		return (
			this.#publication?.getDiagnostics() ?? {
				activePageBytes: 0,
				activePageCount: 0,
				bindingCount: 0,
				longestPublicationDurationMs: 0,
				peakPageBytes: 0,
				publicationDurationMs: 0,
				releasedPageBytes: 0,
				releasedPageCount: 0,
				patchedPageCount: 0,
				patchedRegionBytes: 0,
				uploadedPageBytes: 0,
				uploadedPageCount: 0,
			}
		);
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
): readonly PackedAssetTextureFact[] {
	const factsByKey = new Map<AssetTextureKey, PackedAssetTextureFact>();
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
		const packedFact = fact as PackedAssetTextureFact;
		const existing = factsByKey.get(fact.key);
		if (existing && !factMatches(existing, packedFact)) {
			throw new Error(
				`Atlas texture fact ${fact.key} has conflicting source identity.`,
			);
		}
		factsByKey.set(fact.key, packedFact);
	}
	return [...factsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function factsMatch(
	left: readonly PackedAssetTextureFact[],
	right: readonly PackedAssetTextureFact[],
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
		texturePixelFormatByteLength(texturePurposePolicy(fact.purpose).format);
	if (source.pixels.byteLength !== expectedBytes) {
		throw new Error(
			`Texture preparer returned invalid pixel length for ${fact.key}.`,
		);
	}
}

function atlasPlacementsEqual(
	left: AtlasPlacement,
	right: AtlasPlacement,
): boolean {
	return (
		left.key === right.key &&
		left.contentBounds.x === right.contentBounds.x &&
		left.contentBounds.y === right.contentBounds.y &&
		left.contentBounds.width === right.contentBounds.width &&
		left.contentBounds.height === right.contentBounds.height
	);
}

function pageLayoutsEqual(
	left: AtlasPageLayout,
	right: AtlasPageLayout,
): boolean {
	return (
		left.pageId === right.pageId &&
		left.purpose === right.purpose &&
		left.placements.length === right.placements.length &&
		left.placements.every((placement, index) => {
			const rightPlacement = right.placements[index];
			return (
				rightPlacement !== undefined &&
				atlasPlacementsEqual(placement, rightPlacement)
			);
		})
	);
}

/** One planned page paired with the work its publication needs. */
interface AtlasPageDispositionEntry {
	readonly disposition: AtlasPageDisposition;
	readonly page: AtlasPageLayout;
}

/** How one planned page reaches its published state, cheapest sufficient work first. */
export type AtlasPageDisposition =
	/** Published pixels and metadata already match the plan. */
	| { readonly kind: "unchanged" }
	/** Only releases: published pixels stay, and the freed regions become unreferenced. */
	| { readonly kind: "metadata-only" }
	/** Insertions only touch free regions, so the published resource is patched in place. */
	| {
			readonly kind: "patch";
			readonly insertedKeys: readonly AssetTextureKey[];
	  }
	/** Anything else — a new page, moved placements, or unexplained content. */
	| { readonly kind: "build" };

/**
 * Decide the cheapest sufficient publication work for one planned page.
 *
 * Keys are content-immutable (`asset-texture:{purpose}:{assetId}` over immutable DAT data) and the
 * stable planner never moves a retained placement, so a placement matching its published bounds
 * still has correct pixels. Any placement that neither matches its published bounds nor appears in
 * the plan's inserted set is unexplained, and the page rebuilds rather than guessing.
 */
export function classifyAtlasPageDisposition(
	published: AtlasPageLayout | undefined,
	planned: AtlasPageLayout,
	insertedKeys: ReadonlySet<AssetTextureKey>,
): AtlasPageDisposition {
	if (published === undefined) return { kind: "build" };
	if (pageLayoutsEqual(published, planned)) return { kind: "unchanged" };
	const publishedByKey = new Map(
		published.placements.map((placement) => [placement.key, placement]),
	);
	const patched: AssetTextureKey[] = [];
	for (const placement of planned.placements) {
		const prior = publishedByKey.get(placement.key);
		if (prior !== undefined) {
			if (!atlasPlacementsEqual(prior, placement)) return { kind: "build" };
			continue;
		}
		if (!insertedKeys.has(placement.key)) return { kind: "build" };
		patched.push(placement.key);
	}
	return patched.length === 0
		? { kind: "metadata-only" }
		: { kind: "patch", insertedKeys: patched };
}

/**
 * True when compaction could still satisfy `shouldAcceptCompaction`, judged without planning it.
 *
 * Allocation area gives an exact lower bound on the pages any packing can use, so a layout already
 * sitting at that bound can never compact to fewer pages, and a bound above the rebuild budget can
 * never produce an acceptable plan. Both are necessary conditions, so this never skips a
 * compaction that would have been accepted.
 */
function couldCompactionReducePages(
	stable: StableAtlasLayoutPlan,
	pageSize: number,
	rebuildPageBudget: number,
): boolean {
	if (stable.pages.length < 2) return false;
	const allocatedArea = stable.pages.reduce(
		(total, page) =>
			total +
			page.placements.reduce((pageTotal, placement) => {
				const bounds = allocationBoundsForPlacement(page.purpose, placement);
				return pageTotal + bounds.width * bounds.height;
			}, 0),
		0,
	);
	const minimumPages = Math.ceil(allocatedArea / pageSize ** 2);
	return (
		minimumPages < stable.pages.length && minimumPages <= rebuildPageBudget
	);
}

/**
 * Prefer a compact alternative only for a concrete page-count win that fits the page-build pool's
 * bounded mutation budget. Equal-count plans preserve stable placements and avoid pixel work.
 */
function shouldAcceptCompaction(
	stable: StableAtlasLayoutPlan,
	compact: StableAtlasLayoutPlan,
	rebuildPageBudget: number,
): boolean {
	return (
		compact.pages.length < stable.pages.length &&
		compact.pages.length <= rebuildPageBudget
	);
}
