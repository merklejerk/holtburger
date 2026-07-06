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
	/** Physical page compatibility class. */
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
	/** Physical page compatibility class. */
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
	/** Page lifecycle state before renderer-facing texture commits are emitted. */
	readonly state: "planned" | "building" | "resident" | "reclaimable";
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
	/** Number of shared texture entries tracked by the registry. */
	readonly entryCount: number;
	/** Number of virtual pages currently reserved for page-build work. */
	readonly pageBuildsInFlight: number;
	/** Number of virtual pages tracked by the registry. */
	readonly pageCount: number;
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
	lastActiveState: Exclude<OpenWorldTexturePageRecord["state"], "reclaimable">;
	reservationToken: OpenWorldTexturePageReservationToken | null;
	state: OpenWorldTexturePageRecord["state"];
	stateBeforeBuild: OpenWorldActiveTexturePageState | null;
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
		readonly state?: OpenWorldActiveTexturePageState;
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

		const page: MutableTexturePage = {
			bucketKey: input.bucketKey,
			entryIds: new Set(input.entryIds),
			id: createTexturePageId(input.bucketKey, this.#nextPageNumber),
			lastActiveState: input.state ?? "planned",
			reservationToken: null,
			state: input.state ?? "planned",
			stateBeforeBuild: null,
		};
		this.#nextPageNumber += 1;
		this.#pagesById.set(page.id, page);
		getOrCreatePageIds(this.#pageIdsByBucketKey, input.bucketKey).add(page.id);
		this.#refreshPageReclaimableState(page);
		return snapshotPage(page);
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

	createSnapshot(): OpenWorldTextureClaimRegistrySnapshot {
		let claimCount = 0;
		for (const ownerClaims of this.#bindingIdsByOwnerId.values()) {
			for (const bindingClaims of ownerClaims.values()) {
				claimCount += bindingClaims.size;
			}
		}
		let pageBuildsInFlight = 0;
		for (const page of this.#pagesById.values()) {
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
			pageBuildsInFlight,
			pageCount: this.#pagesById.size,
		};
	}

	#getOrCreateEntry(
		binding: OpenWorldTextureBindingRequirement,
	): MutableTextureEntry {
		const key = createTextureEntryKey(binding);
		const existingId = this.#entryIdsByKey.get(key);
		if (existingId) {
			return this.#entriesById.get(existingId) ?? failMissingEntry(existingId);
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
}

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
	return [
		binding.bucketKey,
		binding.textureKey,
		binding.pageClass,
		binding.purpose,
		binding.sourceKey,
	].join("\n");
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
		reservationToken: page.reservationToken,
		state: page.state,
	};
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
