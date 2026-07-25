import type { SceneInterestRevision } from "../../runtime/scene-availability";
import type { ClosedWorkerPoolDiagnostics } from "../../workers/closed-worker";
import { AABB2, Vec2 } from "../../math/types";
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
	packedObjectTexturePreparation,
	STATIC_OBJECT_TEXTURE_PAGE_SIZE,
	texturePurposePolicy,
	type AssetTextureFact,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
	type TexturePixelFormat,
} from "../types";
import type {
	AtlasPageId,
	AtlasPageLayout,
	StableAtlasLayoutPlan,
	StableAtlasLayoutRequest,
} from "./layout";
import {
	allocationBoundsForPlacement,
	reconstructFreeRectangles,
} from "./layout";
import type { AtlasPageBuildJob, AtlasPageBuildResult } from "./page-build";

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
	readonly activePageCount: number;
	readonly activePageBytes: number;
	readonly peakPageBytes: number;
	readonly acceptedCompactionCount: number;
	readonly avoidedPreparationCount: number;
	readonly claimedTextureCount: number;
	readonly compactionAttemptCount: number;
	readonly copiedSourceBytes: number;
	readonly eliminatedPageCount: number;
	readonly failedCompactionCount: number;
	readonly insertedReuseCount: number;
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
}

interface Requirement<TOwner extends string> {
	readonly facts: readonly PackedAssetTextureFact[];
	readonly handle: AtlasRequirementHandle<TOwner>;
	readonly resolve: (result: AtlasRequirementCompletion) => void;
	state: "preparing" | "ready" | "withdrawn" | "failed";
}

interface ResidentAtlasPage {
	readonly layout: AtlasPageLayout;
	readonly resource: Texture2DResourceKey;
}

/** Fact constrained to the four purposes admitted by this resident atlas. */
type PackedAssetTextureFact = AssetTextureFact & {
	readonly purpose: PackedObjectTexturePurpose;
};

/** Maximum complete replacement pages an optional compaction may materialize in one mutation. */
const MAX_COMPACTION_REBUILD_PAGES = 2;

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
	/** Current published pages and bindings; absent until the physical fixture is injected. */
	readonly #pages = new Map<AtlasPageId, ResidentAtlasPage>();
	readonly #bindings = new Map<AssetTextureKey, TextureAtlasBinding>();
	readonly #purposeLanes = new Map<PackedObjectTexturePurpose, Promise<void>>();
	readonly #purposeEpochs = new Map<PackedObjectTexturePurpose, number>();
	readonly #publishedPurposeEpochs = new Map<
		PackedObjectTexturePurpose,
		number
	>();
	readonly #nextPageGeneration = new Map<PackedObjectTexturePurpose, number>();
	#copiedSourceBytes = 0;
	#peakPageBytes = 0;
	#uploadedPageBytes = 0;
	#uploadedPageCount = 0;
	#releasedPageBytes = 0;
	#releasedPageCount = 0;
	#failedTransactionCount = 0;
	#staleTransactionCount = 0;
	#publicationDurationMs = 0;
	#longestPublicationDurationMs = 0;
	#avoidedPreparationCount = 0;
	#compactionAttemptCount = 0;
	#acceptedCompactionCount = 0;
	#failedCompactionCount = 0;
	#eliminatedPageCount = 0;
	#insertedReuseCount = 0;
	#destroyed = false;

	constructor(
		preparer: TexturePreparer,
		physical: ResidentTextureAtlasPhysicalDependencies | null = null,
	) {
		this.#preparer = preparer;
		this.#physical = physical;
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
			await this.#synchronizePurposes(
				this.#withdrawExact(handle.owner, publishedRevision),
			);
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
		evictedRevision: SceneInterestRevision,
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
		return this.#bindings.get(key) ?? null;
	}

	/** Return one current page resource without exposing retained page pixels. */
	getAtlasPageResource(pageId: `page:${string}`): Texture2DResourceKey | null {
		return this.#pages.get(pageId as AtlasPageId)?.resource ?? null;
	}

	/** Return resource-free source and claim lifetime facts. */
	getDiagnostics(): ResidentTextureAtlasDiagnostics {
		const pageSize =
			this.#physical?.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE;
		return {
			activePageCount: this.#pages.size,
			activePageBytes: [...this.#pages.values()].reduce(
				(total, page) => total + pageByteLength(page.layout.purpose, pageSize),
				0,
			),
			peakPageBytes: this.#peakPageBytes,
			acceptedCompactionCount: this.#acceptedCompactionCount,
			avoidedPreparationCount: this.#avoidedPreparationCount,
			claimedTextureCount: this.#claimsByKey.size,
			compactionAttemptCount: this.#compactionAttemptCount,
			copiedSourceBytes: this.#copiedSourceBytes,
			eliminatedPageCount: this.#eliminatedPageCount,
			failedCompactionCount: this.#failedCompactionCount,
			insertedReuseCount: this.#insertedReuseCount,
			uploadedPageBytes: this.#uploadedPageBytes,
			uploadedPageCount: this.#uploadedPageCount,
			releasedPageBytes: this.#releasedPageBytes,
			releasedPageCount: this.#releasedPageCount,
			failedTransactionCount: this.#failedTransactionCount,
			staleTransactionCount: this.#staleTransactionCount,
			publicationDurationMs: this.#publicationDurationMs,
			longestPublicationDurationMs: this.#longestPublicationDurationMs,
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

	/** Adapt resident facts to the generic texture facade without candidate-page terminology. */
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
			residentAtlasBindings: this.#bindings.size,
			residentSourceBytes: diagnostics.residentSourceBytes,
			residentSourceCount: diagnostics.residentSourceCount,
			reusedAtlasInsertions: diagnostics.insertedReuseCount,
		};
	}

	/** Expose page placement facts for Explorer inspection; every entry is live resident state. */
	getAtlasPageDiagnostics(): readonly TextureAtlasPageDiagnostics[] {
		const pageSize =
			this.#physical?.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE;
		return [...this.#pages.values()]
			.map(({ layout }) => {
				const entries = layout.placements
					.map(({ contentBounds, key }) => ({
						height: contentBounds.height,
						key,
						width: contentBounds.width,
						x: contentBounds.x,
						y: contentBounds.y,
					}))
					.sort((left, right) => left.key.localeCompare(right.key));
				const area = pageSize ** 2;
				const occupiedArea = entries.reduce(
					(total, entry) => total + entry.width * entry.height,
					0,
				);
				const allocatedArea = layout.placements.reduce((total, placement) => {
					const bounds = allocationBoundsForPlacement(
						layout.purpose,
						placement,
					);
					return total + bounds.width * bounds.height;
				}, 0);
				const freeRects = reconstructFreeRectangles(layout, pageSize);
				const largestFreeArea = freeRects.reduce(
					(largest, bounds) => Math.max(largest, bounds.width * bounds.height),
					0,
				);
				return {
					allocatedPixelRatio: allocatedArea / area,
					byteLength: pageByteLength(layout.purpose, pageSize),
					entries,
					entryCount: entries.length,
					height: pageSize,
					largestFreePixelRatio: largestFreeArea / area,
					occupiedPixelRatio: occupiedArea / area,
					pageId: layout.pageId,
					purpose: layout.purpose,
					width: pageSize,
				};
			})
			.sort((left, right) => left.pageId.localeCompare(right.pageId));
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
		} catch {
			if (requirement.state !== "preparing") return;
			this.#withdrawExact(
				requirement.handle.owner,
				requirement.handle.revision,
				"failed",
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
		revision: SceneInterestRevision,
		completion: Exclude<AtlasRequirementCompletion, "ready"> = "withdrawn",
	): readonly PackedObjectTexturePurpose[] {
		const requirement = this.#requirements.get(owner)?.get(revision);
		if (!requirement || requirement.state === "withdrawn") return [];
		const affectedPurposes = new Set<PackedObjectTexturePurpose>();
		if (this.#publishedRevisions.get(owner) === revision) {
			this.#publishedRevisions.delete(owner);
		}
		const requirements = this.#requirements.get(owner)!;
		requirements.delete(revision);
		if (requirements.size === 0) this.#requirements.delete(owner);
		for (const fact of requirement.facts) {
			affectedPurposes.add(fact.purpose);
			const claims = this.#claimsByKey.get(fact.key);
			if (!claims)
				throw new Error(`Resident texture ${fact.key} lost its claim index.`);
			claims.delete(requirement);
			if (claims.size === 0) {
				this.#claimsByKey.delete(fact.key);
				this.#sources.delete(fact.key);
				this.#markPurposeDirty(fact.purpose);
			}
		}
		if (requirement.state === "preparing") requirement.resolve(completion);
		requirement.state = completion;
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
						.every((fact) => this.#bindings.has(fact.key))
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
		const physical = this.#physical;
		if (physical === null || this.#destroyed) return;
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
		const existingPages = [...this.#pages.values()]
			.map((page) => page.layout)
			.filter((page) => page.purpose === purpose);
		const stablePlan = await physical.layoutPlanner.plan({
			correlationId: `resident:${purpose}:${epoch}`,
			entries,
			nextPageGeneration,
			pages: existingPages,
			purpose,
		});
		if (this.#destroyed || this.#purposeEpochs.get(purpose) !== epoch) {
			this.#staleTransactionCount += 1;
			return;
		}
		const stableNewPageCount = stablePlan.pages.filter(
			(page) => !this.#pages.has(page.pageId),
		).length;
		const compactPlan = await physical.layoutPlanner.plan({
			correlationId: `resident:${purpose}:${epoch}:compact`,
			entries,
			nextPageGeneration: nextPageGeneration + stableNewPageCount,
			pages: [],
			purpose,
		});
		if (this.#destroyed || this.#purposeEpochs.get(purpose) !== epoch) {
			this.#staleTransactionCount += 1;
			return;
		}
		const compactAccepted = shouldAcceptCompaction(
			stablePlan,
			compactPlan,
			MAX_COMPACTION_REBUILD_PAGES,
		);
		if (stablePlan.pages.length > 0) this.#compactionAttemptCount += 1;
		if (compactAccepted) {
			try {
				await this.#publishPlan(compactPlan, physical.pageSize);
				if (this.#destroyed || this.#purposeEpochs.get(purpose) !== epoch) {
					this.#staleTransactionCount += 1;
					return;
				}
				this.#publishedPurposeEpochs.set(purpose, epoch);
				this.#nextPageGeneration.set(
					purpose,
					nextPageGeneration + stableNewPageCount + compactPlan.pages.length,
				);
				this.#acceptedCompactionCount += 1;
				this.#eliminatedPageCount +=
					stablePlan.pages.length - compactPlan.pages.length;
				return;
			} catch {
				this.#failedCompactionCount += 1;
				this.#failedTransactionCount += 1;
				// Compaction is optional. The stable plan preserves every existing placement and remains
				// the authoritative fallback after a page-build or upload failure.
			}
		}
		try {
			await this.#publishPlan(stablePlan, physical.pageSize);
		} catch (error) {
			this.#failedTransactionCount += 1;
			throw error;
		}
		if (this.#destroyed || this.#purposeEpochs.get(purpose) !== epoch) {
			this.#staleTransactionCount += 1;
			return;
		}
		this.#publishedPurposeEpochs.set(purpose, epoch);
		this.#nextPageGeneration.set(
			purpose,
			nextPageGeneration + stableNewPageCount,
		);
	}

	async #publishPlan(
		plan: StableAtlasLayoutPlan,
		pageSize: number | undefined,
	): Promise<void> {
		const pagesToBuild = plan.pages.filter((page) => {
			const existing = this.#pages.get(page.pageId);
			return existing === undefined || !pageLayoutsEqual(existing.layout, page);
		});
		const builtPages = await Promise.all(
			pagesToBuild.map((page) =>
				this.#buildPage(page, pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE),
			),
		);
		const existingPageIds = new Set(this.#pages.keys());
		this.#publishPurposePlan(plan, builtPages);
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

	async #buildPage(
		page: AtlasPageLayout,
		pageSize: number,
	): Promise<AtlasPageBuildResult> {
		const sources = page.placements.map((placement) => {
			const source = this.#sources.get(placement.key);
			if (!source) {
				throw new Error(
					`Resident atlas page ${page.pageId} lost retained source ${placement.key}.`,
				);
			}
			return {
				height: source.height,
				key: source.key,
				pixels: source.pixels.slice(),
				width: source.width,
			};
		});
		const transfer = sources.map(
			(source) => source.pixels.buffer as ArrayBuffer,
		);
		const result = await this.#physical!.pageBuilder.build(
			{ page, pageSize, sources },
			transfer,
		);
		this.#copiedSourceBytes += result.copiedSourceBytes;
		return result;
	}

	#publishPurposePlan(
		plan: StableAtlasLayoutPlan,
		builtPages: readonly AtlasPageBuildResult[],
	): void {
		const physical = this.#physical;
		if (physical === null) return;
		const startedAt = performance.now();
		try {
			const created = new Map<AtlasPageId, Texture2DResourceKey>();
			try {
				for (const page of builtPages) {
					created.set(
						page.pageId,
						physical.renderResources.createTexture2D({
							data: page.pageBits,
							format: texturePurposePolicy(page.purpose).format,
							height: page.height,
							mipLevels: mipLevelCount(page.purpose, page.width, page.height),
							width: page.width,
						}),
					);
					this.#uploadedPageCount += 1;
					this.#uploadedPageBytes += page.pageBits.byteLength;
				}
			} catch (cause) {
				for (const [pageId, resource] of created) {
					if (!physical.renderResources.releaseResource(resource)) {
						throw new Error("Resident atlas lost a partial page resource.", {
							cause,
						});
					}
					this.#recordPageRelease(
						plan.pages.find((page) => page.pageId === pageId)!,
					);
				}
				throw cause;
			}
			const oldPages = [...this.#pages.values()].filter(
				(page) => page.layout.purpose === plan.purpose,
			);
			const nextPages = new Map(this.#pages);
			for (const page of oldPages) nextPages.delete(page.layout.pageId);
			for (const layout of plan.pages) {
				const resource =
					created.get(layout.pageId) ??
					this.#pages.get(layout.pageId)?.resource;
				if (!resource) {
					throw new Error(
						`Resident atlas plan lost page resource ${layout.pageId}.`,
					);
				}
				nextPages.set(layout.pageId, { layout, resource });
			}
			const nextBindings = new Map(this.#bindings);
			for (const [key, binding] of nextBindings) {
				if (
					[...this.#pages.values()].some(
						(page) =>
							page.layout.purpose === plan.purpose &&
							page.resource === binding.resource,
					)
				) {
					nextBindings.delete(key);
				}
			}
			for (const page of plan.pages) {
				const resource = nextPages.get(page.pageId)!.resource;
				for (const placement of page.placements) {
					nextBindings.set(placement.key, {
						placement: texturePlacement(page.purpose, placement),
						resource,
					});
				}
			}
			this.#pages.clear();
			for (const [pageId, page] of nextPages) this.#pages.set(pageId, page);
			this.#bindings.clear();
			for (const [key, binding] of nextBindings)
				this.#bindings.set(key, binding);
			this.#peakPageBytes = Math.max(
				this.#peakPageBytes,
				this.#activePageBytes(),
			);
			for (const page of oldPages) {
				if (page.resource === nextPages.get(page.layout.pageId)?.resource)
					continue;
				if (!physical.renderResources.releaseResource(page.resource)) {
					throw new Error(
						`Resident atlas lost superseded page ${page.layout.pageId}.`,
					);
				}
				this.#recordPageRelease(page.layout);
			}
		} finally {
			const durationMs = performance.now() - startedAt;
			this.#publicationDurationMs += durationMs;
			this.#longestPublicationDurationMs = Math.max(
				this.#longestPublicationDurationMs,
				durationMs,
			);
		}
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
		for (const page of this.#pages.values()) {
			if (!physical.renderResources.releaseResource(page.resource)) {
				throw new Error(
					`Resident atlas lost page ${page.layout.pageId} during shutdown.`,
				);
			}
			this.#recordPageRelease(page.layout);
		}
		this.#pages.clear();
		this.#bindings.clear();
		physical.layoutPlanner.destroy();
		physical.pageBuilder.destroy();
	}

	/** Account device memory only after the backend confirms an individual release. */
	#recordPageRelease(page: AtlasPageLayout): void {
		this.#releasedPageCount += 1;
		this.#releasedPageBytes += pageByteLength(
			page.purpose,
			this.#physical?.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE,
		);
	}

	/** Current fixed-page allocation, intentionally independent from content occupancy. */
	#activePageBytes(): number {
		const pageSize =
			this.#physical?.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE;
		return [...this.#pages.values()].reduce(
			(total, page) => total + pageByteLength(page.layout.purpose, pageSize),
			0,
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

function bytesPerPixelForFormat(format: TexturePixelFormat): number {
	switch (format) {
		case "rgba8":
			return 4;
		case "r8":
		case "a8":
			return 1;
		case "rg8":
			return 2;
		default:
			throw new Error(`Resident atlas has unsupported pixel format ${format}.`);
	}
}

function pageByteLength(
	purpose: PackedObjectTexturePurpose,
	pageSize = STATIC_OBJECT_TEXTURE_PAGE_SIZE,
): number {
	return (
		pageSize ** 2 * bytesPerPixelForFormat(texturePurposePolicy(purpose).format)
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
			const candidate = right.placements[index];
			return (
				candidate !== undefined &&
				placement.key === candidate.key &&
				placement.contentBounds.x === candidate.contentBounds.x &&
				placement.contentBounds.y === candidate.contentBounds.y &&
				placement.contentBounds.width === candidate.contentBounds.width &&
				placement.contentBounds.height === candidate.contentBounds.height
			);
		})
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

function texturePlacement(
	purpose: PackedObjectTexturePurpose,
	placement: AtlasPageLayout["placements"][number],
) {
	const { contentBounds } = placement;
	return {
		bounds: new AABB2(
			new Vec2(contentBounds.x, contentBounds.y),
			new Vec2(
				contentBounds.x + contentBounds.width,
				contentBounds.y + contentBounds.height,
			),
		),
		preparation: packedObjectTexturePreparation(purpose),
	};
}

function mipLevelCount(
	purpose: PackedObjectTexturePurpose,
	width: number,
	height: number,
): number {
	if (!texturePurposePolicy(purpose).generateMipmaps) return 1;
	return Math.floor(Math.log2(Math.max(width, height))) + 1;
}
