import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import type { TextureUsagePurpose } from "../../../../textures/placement";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldTextureBucketKey } from "./bucket-key";

/** Stable replacement-owned identity for a shared logical texture entry. */
export type OpenWorldTextureEntryId = string & {
	readonly __brand: "OpenWorldTextureEntryId";
};

/** Replacement-owned identity for virtual atlas pages before renderer upload exists. */
export type OpenWorldTexturePageId = string & {
	readonly __brand: "OpenWorldTexturePageId";
};

/** Token that makes stale page-build results cheap to reject. */
export type OpenWorldTexturePageReservationToken = string & {
	readonly __brand: "OpenWorldTexturePageReservationToken";
};

export interface OpenWorldTextureBindingRequirement {
	/** Material-consumer binding that needs a texture resolution. */
	readonly bindingId: TextureBindingId;
	/** Bucket that owns placement and page-build ordering for this binding. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Optional packer clustering hint owned by the originating domain adapter. */
	readonly affinityKey?: string | null;
	/** Physical page format class. */
	readonly pageClass: TexturePageClass;
	/** Shader/page role for compatible placement reuse. */
	readonly purpose: TextureUsagePurpose;
	/** Prepared source dedupe key used before pixel materialization. */
	readonly sourceKey: string;
	/** Canonical texture identity, excluding owner and binding lifetime. */
	readonly textureKey: TextureKey;
}

interface OpenWorldTextureEntryRecord {
	/** Shared logical entry identity used by claims, pages, and diagnostics. */
	readonly id: OpenWorldTextureEntryId;
	/** Bucket that owns this entry's placement lifecycle. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Binding ids currently resolving through this shared entry. */
	readonly bindingIds: readonly TextureBindingId[];
	/** Owners currently claiming this entry. Empty entries are reclaimable. */
	readonly ownerIds: readonly MaterializationOwnerId[];
	/** Physical page format class. */
	readonly pageClass: TexturePageClass;
	/** Shader/page role for compatible placement reuse. */
	readonly purpose: TextureUsagePurpose;
	/** Prepared source dedupe key used before pixel materialization. */
	readonly sourceKey: string;
	/** Entry lifecycle state from the claim registry's point of view. */
	readonly state: "claimed" | "reclaimable";
	/** Canonical texture identity, excluding owner and binding lifetime. */
	readonly textureKey: TextureKey;
}

export interface OpenWorldTexturePageRecord {
	/** Replacement-owned virtual page id. Renderer page ids are assigned later. */
	readonly id: OpenWorldTexturePageId;
	/** Bucket that serializes build/placement work for this page. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Entries currently assigned to this virtual page. */
	readonly entryIds: readonly OpenWorldTextureEntryId[];
	/** Build reservation token when this page has in-flight worker work. */
	readonly reservationToken: OpenWorldTexturePageReservationToken | null;
	/** Last active page state retained while this page is ownerless and reclaimable. */
	readonly ownerlessRetainedState: OpenWorldActiveTexturePageState | null;
	/** Page lifecycle state before renderer-facing texture commits are emitted. */
	readonly state: "planned" | "building" | "resident" | "reclaimable";
	/** Renderer-facing texture ref owned by this virtual page. */
	readonly textureRefId: string;
	/** Runtime texture page height in pixels when known by placement planning. */
	readonly textureHeight: number | null;
	/** Runtime texture page width in pixels when known by placement planning. */
	readonly textureWidth: number | null;
}

export interface OpenWorldTextureEntryPlacementRecord {
	/** Shared logical entry placed on an accepted or reusable page. */
	readonly entryId: OpenWorldTextureEntryId;
	/** Virtual page currently carrying this entry. */
	readonly pageId: OpenWorldTexturePageId;
	/** Current page state; building pages are reusable for bake work but not renderer-resident yet. */
	readonly pageState: "building" | "reclaimable" | "resident";
	/** Content rect inside the virtual page, excluding gutter pixels. */
	readonly rect: readonly [number, number, number, number];
	/** Renderer-facing texture ref for the virtual page. */
	readonly textureRefId: string;
	/** Runtime texture page height in pixels. */
	readonly textureHeight: number;
	/** Runtime texture page width in pixels. */
	readonly textureWidth: number;
}

export interface OpenWorldTextureResidentBindingPlacementRecord {
	/** Material-consumer binding currently resolving through the page. */
	readonly bindingId: TextureBindingId;
	/** Shared logical entry carrying the binding. */
	readonly entryId: OpenWorldTextureEntryId;
	/** Content rect inside the virtual page, excluding gutter pixels. */
	readonly rect: readonly [number, number, number, number];
	/** Renderer-facing texture ref for the virtual page. */
	readonly textureRefId: string;
	/** Runtime texture page height in pixels. */
	readonly textureHeight: number;
	/** Runtime texture page width in pixels. */
	readonly textureWidth: number;
}

export interface OpenWorldTextureBucketSnapshot {
	/** Bucket represented by this snapshot. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Shared entry records in deterministic order. */
	readonly entries: readonly OpenWorldTextureEntryRecord[];
	/** Virtual page records in deterministic order. */
	readonly pages: readonly OpenWorldTexturePageRecord[];
}

export interface OpenWorldTextureClaimRegistrySnapshot {
	/** Number of buckets with claimed entries or virtual pages. */
	readonly bucketCount: number;
	/** Number of owner binding claims currently retained. */
	readonly claimCount: number;
	/** Number of tracked texture entries with zero current owners. */
	readonly ownerlessEntryCount: number;
	/** Ownerless reclaimable pages grouped by the active state they retain. */
	readonly ownerlessPageCountByRetainedState: {
		readonly building: number;
		readonly planned: number;
		readonly resident: number;
	};
	/** Current ownerless page retention/removal policy owned by texture residency. */
	readonly ownerlessPagePolicy: OpenWorldTextureOwnerlessPagePolicySnapshot;
	/** Number of shared texture entries tracked by the registry. */
	readonly entryCount: number;
	/** Number of virtual pages currently reserved for page-build work. */
	readonly pageBuildsInFlight: number;
	/** Number of virtual pages tracked by the registry. */
	readonly pageCount: number;
	/** Virtual page count grouped by replacement lifecycle state. */
	readonly pageCountByState: {
		readonly building: number;
		readonly planned: number;
		readonly reclaimable: number;
		readonly resident: number;
	};
}

interface OpenWorldTextureOwnerlessPagePolicySnapshot {
	/** Disposition for ownerless renderer-resident pages before memory pressure exists. */
	readonly residentDisposition: "cached-for-reuse";
	/** Renderer removal is explicit policy work, never a side effect of owner release. */
	readonly rendererRemoval: {
		readonly kind: "deferred-until-measured-pressure";
		/** Null means no measured pressure threshold has been chosen yet. */
		readonly pressureThresholdBytes: number | null;
	};
	/** Pages selected by policy but not yet emitted as texture removal commits. */
	readonly pendingRendererRemovalPageCount: number;
}

interface MutableTextureEntry {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly id: OpenWorldTextureEntryId;
	readonly bindingIds: Set<TextureBindingId>;
	readonly ownerIds: Set<MaterializationOwnerId>;
	readonly pageClass: TexturePageClass;
	readonly purpose: TextureUsagePurpose;
	readonly sourceKey: string;
	readonly textureKey: TextureKey;
}

interface MutableTexturePage {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly entryIds: Set<OpenWorldTextureEntryId>;
	readonly id: OpenWorldTexturePageId;
	readonly placementsByEntryId: Map<
		OpenWorldTextureEntryId,
		readonly [number, number, number, number]
	>;
	lastActiveState: Exclude<OpenWorldTexturePageRecord["state"], "reclaimable">;
	reservationToken: OpenWorldTexturePageReservationToken | null;
	state: OpenWorldTexturePageRecord["state"];
	stateBeforeBuild: OpenWorldActiveTexturePageState | null;
	readonly textureRefId: string;
	readonly textureHeight: number | null;
	readonly textureWidth: number | null;
}

type OpenWorldActiveTexturePageState = Exclude<
	OpenWorldTexturePageRecord["state"],
	"reclaimable"
>;

type OwnerBucketClaims = Map<
	OpenWorldTextureBucketKey,
	Map<TextureBindingId, OpenWorldTextureEntryId>
>;

export class OpenWorldTextureClaimRegistry {
	readonly #bindingIdsByOwnerId = new Map<
		MaterializationOwnerId,
		OwnerBucketClaims
	>();
	readonly #entryIdsByKey = new Map<string, OpenWorldTextureEntryId>();
	readonly #entriesById = new Map<
		OpenWorldTextureEntryId,
		MutableTextureEntry
	>();
	readonly #pageIdsByBucketKey = new Map<
		OpenWorldTextureBucketKey,
		Set<OpenWorldTexturePageId>
	>();
	readonly #pagesById = new Map<OpenWorldTexturePageId, MutableTexturePage>();
	#nextEntryNumber = 1;
	#nextPageNumber = 1;
	#nextReservationNumber = 1;

	retainTextureBindings(
		ownerId: MaterializationOwnerId,
		bucketKey: OpenWorldTextureBucketKey,
		bindings: readonly OpenWorldTextureBindingRequirement[],
	): OpenWorldTextureBucketSnapshot {
		for (const binding of bindings) {
			if (binding.bucketKey !== bucketKey) {
				throw new Error(
					`Texture binding ${binding.bindingId} belongs to bucket ${binding.bucketKey}, not ${bucketKey}.`,
				);
			}
		}

		const ownerClaims = getOrCreateOwnerClaims(
			this.#bindingIdsByOwnerId,
			ownerId,
		);
		const previousClaims = ownerClaims.get(bucketKey) ?? new Map();
		this.#removeOwnerClaims(ownerId, previousClaims);

		const nextClaims = new Map<TextureBindingId, OpenWorldTextureEntryId>();
		for (const binding of bindings) {
			const entry = this.#getOrCreateEntry(binding);
			entry.ownerIds.add(ownerId);
			entry.bindingIds.add(binding.bindingId);
			nextClaims.set(binding.bindingId, entry.id);
			this.#refreshPagesForEntry(entry.id);
		}

		if (nextClaims.size === 0) {
			ownerClaims.delete(bucketKey);
		} else {
			ownerClaims.set(bucketKey, nextClaims);
		}
		if (ownerClaims.size === 0) {
			this.#bindingIdsByOwnerId.delete(ownerId);
		}

		return this.createBucketSnapshot(bucketKey);
	}

	releaseTextureOwner(ownerId: MaterializationOwnerId): void {
		const ownerClaims = this.#bindingIdsByOwnerId.get(ownerId);
		if (!ownerClaims) {
			return;
		}

		for (const bindingClaims of ownerClaims.values()) {
			this.#removeOwnerClaims(ownerId, bindingClaims);
		}
		this.#bindingIdsByOwnerId.delete(ownerId);
	}

	createPage(input: {
		readonly bucketKey: OpenWorldTextureBucketKey;
		readonly entryIds: readonly OpenWorldTextureEntryId[];
		readonly placements?: readonly {
			readonly entryId: OpenWorldTextureEntryId;
			readonly rect: readonly [number, number, number, number];
		}[];
		readonly state?: OpenWorldActiveTexturePageState;
		readonly textureHeight?: number;
		readonly textureRefId?: string;
		readonly textureWidth?: number;
	}): OpenWorldTexturePageRecord {
		for (const entryId of input.entryIds) {
			const entry = this.#entriesById.get(entryId);
			if (!entry) {
				throw new Error(
					`Cannot assign missing texture entry to page: ${entryId}.`,
				);
			}
			if (entry.bucketKey !== input.bucketKey) {
				throw new Error(
					`Cannot assign texture entry ${entryId} from bucket ${entry.bucketKey} to page bucket ${input.bucketKey}.`,
				);
			}
		}
		const entryIdSet = new Set(input.entryIds);
		const placementsByEntryId = new Map<
			OpenWorldTextureEntryId,
			readonly [number, number, number, number]
		>();
		for (const placement of input.placements ?? []) {
			if (!entryIdSet.has(placement.entryId)) {
				throw new Error(
					`Cannot assign placement for entry ${placement.entryId} that is not on the texture page.`,
				);
			}
			if (placementsByEntryId.has(placement.entryId)) {
				throw new Error(
					`Cannot assign multiple placements for texture entry ${placement.entryId}.`,
				);
			}
			placementsByEntryId.set(placement.entryId, placement.rect);
		}

		const pageId = createTexturePageId(input.bucketKey, this.#nextPageNumber);

		const page: MutableTexturePage = {
			bucketKey: input.bucketKey,
			entryIds: new Set(input.entryIds),
			id: pageId,
			lastActiveState: input.state ?? "planned",
			placementsByEntryId,
			reservationToken: null,
			state: input.state ?? "planned",
			stateBeforeBuild: null,
			textureHeight: input.textureHeight ?? null,
			textureRefId: input.textureRefId ?? `${pageId}:texture`,
			textureWidth: input.textureWidth ?? null,
		};
		this.#nextPageNumber += 1;
		this.#pagesById.set(page.id, page);
		getOrCreatePageIds(this.#pageIdsByBucketKey, input.bucketKey).add(page.id);
		this.#refreshPageReclaimableState(page);
		return snapshotPage(page);
	}

	findReusableEntryPlacement(
		entryId: OpenWorldTextureEntryId,
	): OpenWorldTextureEntryPlacementRecord | null {
		for (const page of this.#pagesById.values()) {
			if (!page.entryIds.has(entryId)) {
				continue;
			}
			this.#refreshPageReclaimableState(page);
			if (!isReusablePageState(page)) {
				continue;
			}
			const rect = page.placementsByEntryId.get(entryId);
			if (!rect) {
				throw new Error(
					`Texture entry ${entryId} is on reusable page ${page.id} without placement facts.`,
				);
			}
			if (page.textureHeight === null || page.textureWidth === null) {
				throw new Error(
					`Texture entry ${entryId} is on reusable page ${page.id} without page dimensions.`,
				);
			}
			return {
				entryId,
				pageId: page.id,
				pageState: requireReusablePageState(page.state),
				rect,
				textureHeight: page.textureHeight,
				textureRefId: page.textureRefId,
				textureWidth: page.textureWidth,
			};
		}
		return null;
	}

	createResidentBindingPlacementsForPage(input: {
		readonly pageId: OpenWorldTexturePageId;
		readonly textureHeight: number;
		readonly textureRefId: string;
		readonly textureWidth: number;
	}): readonly OpenWorldTextureResidentBindingPlacementRecord[] {
		const page = this.#requirePage(input.pageId);
		if (page.textureRefId !== input.textureRefId) {
			throw new Error(
				`Texture page ${input.pageId} accepted texture ref ${input.textureRefId}, but registry expected ${page.textureRefId}.`,
			);
		}
		const bindingPlacements: OpenWorldTextureResidentBindingPlacementRecord[] =
			[];
		for (const entryId of [...page.entryIds].sort()) {
			const entry = this.#entriesById.get(entryId);
			if (!entry) {
				throw new Error(
					`Texture page ${input.pageId} references missing entry ${entryId}.`,
				);
			}
			const rect = page.placementsByEntryId.get(entryId);
			if (!rect) {
				throw new Error(
					`Texture page ${input.pageId} is missing placement facts for entry ${entryId}.`,
				);
			}
			for (const bindingId of [...entry.bindingIds].sort()) {
				bindingPlacements.push({
					bindingId,
					entryId,
					rect,
					textureHeight: input.textureHeight,
					textureRefId: input.textureRefId,
					textureWidth: input.textureWidth,
				});
			}
		}
		return bindingPlacements;
	}

	reservePageBuild(
		pageId: OpenWorldTexturePageId,
	): OpenWorldTexturePageReservationToken {
		const page = this.#requirePage(pageId);
		if (page.state === "reclaimable") {
			throw new Error(`Cannot reserve reclaimable texture page: ${pageId}.`);
		}
		const token = createTexturePageReservationToken(
			pageId,
			this.#nextReservationNumber,
		);
		this.#nextReservationNumber += 1;
		page.reservationToken = token;
		page.stateBeforeBuild = page.state;
		page.lastActiveState = "building";
		page.state = "building";
		return token;
	}

	acceptPageBuild(
		pageId: OpenWorldTexturePageId,
		token: OpenWorldTexturePageReservationToken,
	): "accepted" | "stale" {
		const page = this.#requirePage(pageId);
		if (page.reservationToken !== token) {
			return "stale";
		}
		page.reservationToken = null;
		page.stateBeforeBuild = null;
		page.lastActiveState = "resident";
		page.state = "resident";
		this.#refreshPageReclaimableState(page);
		return "accepted";
	}

	acceptPageBuildNoop(
		pageId: OpenWorldTexturePageId,
		token: OpenWorldTexturePageReservationToken,
	): "accepted" | "stale" {
		const page = this.#requirePage(pageId);
		if (page.reservationToken !== token) {
			return "stale";
		}
		page.reservationToken = null;
		page.state = page.stateBeforeBuild ?? "planned";
		page.lastActiveState = page.state;
		page.stateBeforeBuild = null;
		this.#refreshPageReclaimableState(page);
		return "accepted";
	}

	rejectPageBuild(
		pageId: OpenWorldTexturePageId,
		token: OpenWorldTexturePageReservationToken,
	): "accepted" | "stale" {
		const page = this.#requirePage(pageId);
		if (page.reservationToken !== token) {
			return "stale";
		}
		page.reservationToken = null;
		page.state = page.stateBeforeBuild ?? "planned";
		page.lastActiveState = page.state;
		page.stateBeforeBuild = null;
		this.#refreshPageReclaimableState(page);
		return "accepted";
	}

	createBucketSnapshot(
		bucketKey: OpenWorldTextureBucketKey,
	): OpenWorldTextureBucketSnapshot {
		const entries = [...this.#entriesById.values()]
			.filter((entry) => entry.bucketKey === bucketKey)
			.sort(compareEntries)
			.map(snapshotEntry);
		const pages = [...(this.#pageIdsByBucketKey.get(bucketKey) ?? [])]
			.map((pageId) => this.#requirePage(pageId))
			.sort(comparePages)
			.map((page) => {
				this.#refreshPageReclaimableState(page);
				return snapshotPage(page);
			});
		return {
			bucketKey,
			entries,
			pages,
		};
	}

	createBucketSnapshots(): readonly OpenWorldTextureBucketSnapshot[] {
		return [...this.#collectBucketKeys()]
			.sort()
			.map((bucketKey) => this.createBucketSnapshot(bucketKey));
	}

	createSnapshot(): OpenWorldTextureClaimRegistrySnapshot {
		let claimCount = 0;
		for (const ownerClaims of this.#bindingIdsByOwnerId.values()) {
			for (const bindingClaims of ownerClaims.values()) {
				claimCount += bindingClaims.size;
			}
		}
		let ownerlessEntryCount = 0;
		for (const entry of this.#entriesById.values()) {
			if (entry.ownerIds.size === 0) {
				ownerlessEntryCount += 1;
			}
		}
		let pageBuildsInFlight = 0;
		const ownerlessPageCountByRetainedState = {
			building: 0,
			planned: 0,
			resident: 0,
		};
		const pageCountByState = {
			building: 0,
			planned: 0,
			reclaimable: 0,
			resident: 0,
		};
		for (const page of this.#pagesById.values()) {
			this.#refreshPageReclaimableState(page);
			pageCountByState[page.state] += 1;
			if (page.state === "reclaimable") {
				ownerlessPageCountByRetainedState[page.lastActiveState] += 1;
			}
			if (page.reservationToken !== null) {
				pageBuildsInFlight += 1;
			}
		}
		return {
			bucketCount: new Set([
				...this.#pageIdsByBucketKey.keys(),
				...[...this.#entriesById.values()].map((entry) => entry.bucketKey),
			]).size,
			claimCount,
			entryCount: this.#entriesById.size,
			ownerlessEntryCount,
			ownerlessPageCountByRetainedState,
			ownerlessPagePolicy: OWNERLESS_PAGE_POLICY,
			pageBuildsInFlight,
			pageCount: this.#pagesById.size,
			pageCountByState,
		};
	}

	#getOrCreateEntry(
		binding: OpenWorldTextureBindingRequirement,
	): MutableTextureEntry {
		const key = createTextureEntryKey(binding);
		const existingId = this.#entryIdsByKey.get(key);
		if (existingId) {
			const entry =
				this.#entriesById.get(existingId) ?? failMissingEntry(existingId);
			assertCompatibleTextureEntry(entry, binding);
			return entry;
		}

		const entry: MutableTextureEntry = {
			bindingIds: new Set(),
			bucketKey: binding.bucketKey,
			id: createTextureEntryId(binding.bucketKey, this.#nextEntryNumber),
			ownerIds: new Set(),
			pageClass: binding.pageClass,
			purpose: binding.purpose,
			sourceKey: binding.sourceKey,
			textureKey: binding.textureKey,
		};
		this.#nextEntryNumber += 1;
		this.#entryIdsByKey.set(key, entry.id);
		this.#entriesById.set(entry.id, entry);
		return entry;
	}

	#removeOwnerClaims(
		ownerId: MaterializationOwnerId,
		claims: ReadonlyMap<TextureBindingId, OpenWorldTextureEntryId>,
	): void {
		for (const [bindingId, entryId] of claims) {
			const entry = this.#entriesById.get(entryId);
			if (!entry) {
				throw new Error(
					`Owner ${ownerId} claimed missing texture entry ${entryId}.`,
				);
			}
			entry.ownerIds.delete(ownerId);
			entry.bindingIds.delete(bindingId);
			this.#refreshPagesForEntry(entryId);
		}
	}

	#refreshPagesForEntry(entryId: OpenWorldTextureEntryId): void {
		for (const page of this.#pagesById.values()) {
			if (page.entryIds.has(entryId)) {
				this.#refreshPageReclaimableState(page);
			}
		}
	}

	#refreshPageReclaimableState(page: MutableTexturePage): void {
		if (page.state === "building") {
			return;
		}
		if (page.entryIds.size === 0) {
			page.state = "reclaimable";
			return;
		}
		const hasClaimedEntry = [...page.entryIds].some((entryId) => {
			const entry = this.#entriesById.get(entryId);
			return entry ? entry.ownerIds.size > 0 : false;
		});
		if (!hasClaimedEntry) {
			if (page.state !== "reclaimable") {
				page.lastActiveState = page.state;
			}
			page.state = "reclaimable";
			return;
		}
		if (page.state === "reclaimable") {
			page.state = page.lastActiveState;
		}
	}

	#requirePage(pageId: OpenWorldTexturePageId): MutableTexturePage {
		const page = this.#pagesById.get(pageId);
		if (!page) {
			throw new Error(`Unknown texture page: ${pageId}.`);
		}
		return page;
	}

	#collectBucketKeys(): ReadonlySet<OpenWorldTextureBucketKey> {
		return new Set([
			...this.#pageIdsByBucketKey.keys(),
			...[...this.#entriesById.values()].map((entry) => entry.bucketKey),
		]);
	}
}

const OWNERLESS_PAGE_POLICY: OpenWorldTextureOwnerlessPagePolicySnapshot = {
	pendingRendererRemovalPageCount: 0,
	rendererRemoval: {
		kind: "deferred-until-measured-pressure",
		pressureThresholdBytes: null,
	},
	residentDisposition: "cached-for-reuse",
};

export function groupTextureBindingRequirementsByBucket(
	bindings: readonly OpenWorldTextureBindingRequirement[],
): ReadonlyMap<
	OpenWorldTextureBucketKey,
	readonly OpenWorldTextureBindingRequirement[]
> {
	const grouped = new Map<
		OpenWorldTextureBucketKey,
		OpenWorldTextureBindingRequirement[]
	>();
	for (const binding of bindings) {
		const bucket = grouped.get(binding.bucketKey);
		if (bucket) {
			bucket.push(binding);
		} else {
			grouped.set(binding.bucketKey, [binding]);
		}
	}
	return grouped;
}

function createTextureEntryKey(
	binding: OpenWorldTextureBindingRequirement,
): string {
	return [binding.bucketKey, binding.textureKey].join("\n");
}

function assertCompatibleTextureEntry(
	entry: MutableTextureEntry,
	binding: OpenWorldTextureBindingRequirement,
): void {
	if (entry.pageClass !== binding.pageClass) {
		throw new Error(
			`Texture ${binding.textureKey} in bucket ${binding.bucketKey} changed page class from ${entry.pageClass} to ${binding.pageClass}.`,
		);
	}
	if (entry.purpose !== binding.purpose) {
		throw new Error(
			`Texture ${binding.textureKey} in bucket ${binding.bucketKey} changed purpose from ${entry.purpose} to ${binding.purpose}.`,
		);
	}
	if (entry.sourceKey !== binding.sourceKey) {
		throw new Error(
			`Texture ${binding.textureKey} in bucket ${binding.bucketKey} changed source key from ${entry.sourceKey} to ${binding.sourceKey}.`,
		);
	}
}

function createTextureEntryId(
	bucketKey: OpenWorldTextureBucketKey,
	sequence: number,
): OpenWorldTextureEntryId {
	return `${bucketKey}:entry:${sequence}` as OpenWorldTextureEntryId;
}

function createTexturePageId(
	bucketKey: OpenWorldTextureBucketKey,
	sequence: number,
): OpenWorldTexturePageId {
	return `${bucketKey}:page:${sequence}` as OpenWorldTexturePageId;
}

function createTexturePageReservationToken(
	pageId: OpenWorldTexturePageId,
	sequence: number,
): OpenWorldTexturePageReservationToken {
	return `${pageId}:reservation:${sequence}` as OpenWorldTexturePageReservationToken;
}

function getOrCreateOwnerClaims(
	claimsByOwnerId: Map<MaterializationOwnerId, OwnerBucketClaims>,
	ownerId: MaterializationOwnerId,
): OwnerBucketClaims {
	const existing = claimsByOwnerId.get(ownerId);
	if (existing) {
		return existing;
	}
	const claims = new Map();
	claimsByOwnerId.set(ownerId, claims);
	return claims;
}

function getOrCreatePageIds(
	pageIdsByBucketKey: Map<
		OpenWorldTextureBucketKey,
		Set<OpenWorldTexturePageId>
	>,
	bucketKey: OpenWorldTextureBucketKey,
): Set<OpenWorldTexturePageId> {
	const existing = pageIdsByBucketKey.get(bucketKey);
	if (existing) {
		return existing;
	}
	const pageIds = new Set<OpenWorldTexturePageId>();
	pageIdsByBucketKey.set(bucketKey, pageIds);
	return pageIds;
}

function failMissingEntry(entryId: OpenWorldTextureEntryId): never {
	throw new Error(`Texture entry index referenced missing entry: ${entryId}.`);
}

function snapshotEntry(
	entry: MutableTextureEntry,
): OpenWorldTextureEntryRecord {
	return {
		bindingIds: [...entry.bindingIds].sort(),
		bucketKey: entry.bucketKey,
		id: entry.id,
		ownerIds: [...entry.ownerIds].sort(),
		pageClass: entry.pageClass,
		purpose: entry.purpose,
		sourceKey: entry.sourceKey,
		state: entry.ownerIds.size > 0 ? "claimed" : "reclaimable",
		textureKey: entry.textureKey,
	};
}

function snapshotPage(page: MutableTexturePage): OpenWorldTexturePageRecord {
	return {
		bucketKey: page.bucketKey,
		entryIds: [...page.entryIds].sort(),
		id: page.id,
		ownerlessRetainedState:
			page.state === "reclaimable" ? page.lastActiveState : null,
		reservationToken: page.reservationToken,
		state: page.state,
		textureHeight: page.textureHeight,
		textureRefId: page.textureRefId,
		textureWidth: page.textureWidth,
	};
}

function isReusablePageState(page: MutableTexturePage): boolean {
	return (
		page.state === "building" ||
		page.state === "resident" ||
		(page.state === "reclaimable" && page.lastActiveState === "resident")
	);
}

function requireReusablePageState(
	state: MutableTexturePage["state"],
): OpenWorldTextureEntryPlacementRecord["pageState"] {
	if (state === "building" || state === "resident" || state === "reclaimable") {
		return state;
	}
	throw new Error(`Texture page state ${state} is not reusable.`);
}

function compareEntries(
	left: MutableTextureEntry,
	right: MutableTextureEntry,
): number {
	return left.id.localeCompare(right.id);
}

function comparePages(
	left: MutableTexturePage,
	right: MutableTexturePage,
): number {
	return left.id.localeCompare(right.id);
}
