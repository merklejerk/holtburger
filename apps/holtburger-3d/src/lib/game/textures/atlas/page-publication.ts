import { AABB2, Vec2 } from "../../math/types";
import type {
	RendererResourceManager,
	Texture2DResourceKey,
} from "../../renderer/resource-manager";
import type {
	TextureAtlasBinding,
	TextureAtlasPageDiagnostics,
} from "../texture-manager";
import {
	packedObjectTexturePreparation,
	textureMipChainByteLength,
	texturePurposeMipLevelCount,
	texturePurposePolicy,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
} from "../types";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import {
	allocationBoundsForPlacement,
	reconstructFreeRectangles,
	type AtlasPageId,
	type AtlasPageLayout,
	type StableAtlasLayoutPlan,
} from "./layout";
import type { AtlasPageBuildResult, AtlasPagePatchResult } from "./page-build";

/**
 * Complete device payloads for one publication.
 *
 * `built` pages replace their resource wholesale; `patched` pages keep their resource and
 * receive only the regions their newly inserted placements occupy.
 */
export interface AtlasPagePayloads {
	readonly built: readonly AtlasPageBuildResult[];
	readonly patched: readonly AtlasPagePatchResult[];
}

/** Resource-backed page snapshot owned privately by one resident-atlas publication state. */
interface PublishedAtlasPage {
	readonly layout: AtlasPageLayout;
	readonly resource: Texture2DResourceKey;
}

/** Device-publication counters separate from logical claim and source retention state. */
export interface AtlasPagePublicationDiagnostics {
	/** Retained device allocation bytes including every purpose-promised mip level. */
	readonly activePageBytes: number;
	readonly activePageCount: number;
	readonly bindingCount: number;
	readonly longestPublicationDurationMs: number;
	/** Largest retained device allocation observed, including mip levels. */
	readonly peakPageBytes: number;
	readonly publicationDurationMs: number;
	/** Released device allocation bytes including every purpose-promised mip level. */
	readonly releasedPageBytes: number;
	readonly releasedPageCount: number;
	/** Level-zero worker payload bytes submitted for texture creation. */
	readonly uploadedPageBytes: number;
	readonly uploadedPageCount: number;
	/** Pages brought up to date in place instead of being replaced. */
	readonly patchedPageCount: number;
	/** Level-zero region bytes written into retained page resources. */
	readonly patchedRegionBytes: number;
}

/**
 * Owns only device-page replacement and binding publication for one resident atlas.
 *
 * Claim lifetime, prepared sources, revision state, and layout planning remain in
 * `ResidentTextureAtlas`; this collaborator deliberately has no owner or source APIs.
 */
export class AtlasPagePublication {
	readonly #pageSize: number;
	readonly #renderResources: RendererResourceManager;
	readonly #pages = new Map<AtlasPageId, PublishedAtlasPage>();
	readonly #bindings = new Map<AssetTextureKey, TextureAtlasBinding>();
	#peakPageBytes = 0;
	#uploadedPageBytes = 0;
	#uploadedPageCount = 0;
	#releasedPageBytes = 0;
	#releasedPageCount = 0;
	#publicationDurationMs = 0;
	#longestPublicationDurationMs = 0;
	#patchedPageCount = 0;
	#patchedRegionBytes = 0;

	constructor(
		renderResources: RendererResourceManager,
		pageSize: number = SHARED_FRONTEND_TUNING.workloads.staticObjectTextureAtlas
			.pageSize,
	) {
		this.#renderResources = renderResources;
		this.#pageSize = pageSize;
	}

	getBinding(key: AssetTextureKey): TextureAtlasBinding | null {
		return this.#bindings.get(key) ?? null;
	}

	getDiagnostics(): AtlasPagePublicationDiagnostics {
		return {
			activePageBytes: this.#activePageBytes(),
			activePageCount: this.#pages.size,
			bindingCount: this.#bindings.size,
			longestPublicationDurationMs: this.#longestPublicationDurationMs,
			peakPageBytes: this.#peakPageBytes,
			publicationDurationMs: this.#publicationDurationMs,
			releasedPageBytes: this.#releasedPageBytes,
			releasedPageCount: this.#releasedPageCount,
			uploadedPageBytes: this.#uploadedPageBytes,
			uploadedPageCount: this.#uploadedPageCount,
			patchedPageCount: this.#patchedPageCount,
			patchedRegionBytes: this.#patchedRegionBytes,
		};
	}

	getPageDiagnostics(): readonly TextureAtlasPageDiagnostics[] {
		return [...this.#pages.values()]
			.map(({ layout }) => pageDiagnostics(layout, this.#pageSize))
			.sort((left, right) => left.pageId.localeCompare(right.pageId));
	}

	getPageResource(pageId: `page:${string}`): Texture2DResourceKey | null {
		return this.#pages.get(pageId as AtlasPageId)?.resource ?? null;
	}

	getPurposeLayouts(
		purpose: PackedObjectTexturePurpose,
	): readonly AtlasPageLayout[] {
		return [...this.#pages.values()]
			.map((page) => page.layout)
			.filter((page) => page.purpose === purpose);
	}

	hasPage(pageId: AtlasPageId): boolean {
		return this.#pages.has(pageId);
	}

	/**
	 * Bring one purpose's pages and bindings to the planned state.
	 *
	 * The page set, binding table, and resource releases still swap atomically. Level-zero
	 * texels for patched pages land before that swap, in regions the currently published
	 * layout does not reference, so no reader can observe them until the swap commits.
	 * Returns whether an already-published, surviving binding changed. New claims have no
	 * cached consumers yet; withdrawn claims retire their consumers before releasing ownership.
	 */
	publish(plan: StableAtlasLayoutPlan, payloads: AtlasPagePayloads): boolean {
		const startedAt = performance.now();
		try {
			// Patches run before any resource is created so a failed region write leaves both the
			// committed metadata and the created-resource set untouched; the partially written
			// texels sit in regions the still-current layout does not reference.
			const patchedRegionBytes = this.#applyPatches(payloads.patched);
			const created = this.#createResources(plan, payloads.built);
			const oldPages = this.#currentPurposePages(plan.purpose);
			const nextPages = this.#nextPages(plan, created, oldPages);
			const { bindings, retainedBindingsChanged } = this.#nextBindings(
				plan,
				nextPages,
				oldPages,
			);
			this.#pages.clear();
			for (const [pageId, page] of nextPages) this.#pages.set(pageId, page);
			this.#bindings.clear();
			for (const [key, binding] of bindings) this.#bindings.set(key, binding);
			this.#peakPageBytes = Math.max(
				this.#peakPageBytes,
				this.#activePageBytes(),
			);
			this.#releaseSupersededPages(oldPages, nextPages);
			// Patch counters commit with the publication: writes made before a later failure are
			// not work that landed, and the caller's rebuild fallback will overwrite them.
			this.#patchedPageCount += payloads.patched.length;
			this.#patchedRegionBytes += patchedRegionBytes;
			return retainedBindingsChanged;
		} finally {
			const durationMs = performance.now() - startedAt;
			this.#publicationDurationMs += durationMs;
			this.#longestPublicationDurationMs = Math.max(
				this.#longestPublicationDurationMs,
				durationMs,
			);
		}
	}

	/** Write every patch's regions, returning the level-zero bytes those writes covered. */
	#applyPatches(patched: readonly AtlasPagePatchResult[]): number {
		let regionBytes = 0;
		for (const patch of patched) {
			const page = this.#pages.get(patch.pageId);
			if (!page) {
				throw new Error(
					`Resident atlas cannot patch unpublished page ${patch.pageId}.`,
				);
			}
			this.#renderResources.updateTexture2DRegions(
				page.resource,
				patch.regions,
			);
			regionBytes += patch.regions.reduce(
				(total, region) => total + region.data.byteLength,
				0,
			);
		}
		return regionBytes;
	}

	#createResources(
		plan: StableAtlasLayoutPlan,
		builtPages: readonly AtlasPageBuildResult[],
	): ReadonlyMap<AtlasPageId, Texture2DResourceKey> {
		const created = new Map<AtlasPageId, Texture2DResourceKey>();
		try {
			for (const page of builtPages) {
				created.set(
					page.pageId,
					this.#renderResources.createTexture2D({
						data: page.pageBits,
						format: texturePurposePolicy(page.purpose).format,
						height: page.height,
						mipLevels: texturePurposeMipLevelCount(
							page.purpose,
							page.width,
							page.height,
						),
						width: page.width,
					}),
				);
				this.#uploadedPageCount += 1;
				this.#uploadedPageBytes += page.pageBits.byteLength;
			}
			return created;
		} catch (cause) {
			for (const [pageId, resource] of created) {
				if (!this.#renderResources.releaseResource(resource)) {
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
	}

	#currentPurposePages(
		purpose: PackedObjectTexturePurpose,
	): readonly PublishedAtlasPage[] {
		return [...this.#pages.values()].filter(
			(page) => page.layout.purpose === purpose,
		);
	}

	#nextPages(
		plan: StableAtlasLayoutPlan,
		created: ReadonlyMap<AtlasPageId, Texture2DResourceKey>,
		oldPages: readonly PublishedAtlasPage[],
	): Map<AtlasPageId, PublishedAtlasPage> {
		const nextPages = new Map(this.#pages);
		for (const page of oldPages) nextPages.delete(page.layout.pageId);
		for (const layout of plan.pages) {
			const resource =
				created.get(layout.pageId) ?? this.#pages.get(layout.pageId)?.resource;
			if (!resource) {
				throw new Error(
					`Resident atlas plan lost page resource ${layout.pageId}.`,
				);
			}
			nextPages.set(layout.pageId, { layout, resource });
		}
		return nextPages;
	}

	#nextBindings(
		plan: StableAtlasLayoutPlan,
		nextPages: ReadonlyMap<AtlasPageId, PublishedAtlasPage>,
		oldPages: readonly PublishedAtlasPage[],
	): {
		/** Complete binding snapshot committed by the publication. */
		readonly bindings: Map<AssetTextureKey, TextureAtlasBinding>;
		/** Semantic changes requiring consumers to resolve retained bindings again. */
		readonly retainedBindingsChanged: boolean;
	} {
		const oldResources = new Set(oldPages.map((page) => page.resource));
		const nextBindings = new Map(this.#bindings);
		let retainedBindingsChanged = false;
		for (const [key, binding] of nextBindings) {
			if (oldResources.has(binding.resource)) nextBindings.delete(key);
		}
		for (const page of plan.pages) {
			const resource = nextPages.get(page.pageId)!.resource;
			for (const placement of page.placements) {
				const binding: TextureAtlasBinding = {
					placement: texturePlacement(page.purpose, placement),
					resource,
				};
				const previous = this.#bindings.get(placement.key);
				if (previous && !sameBinding(previous, binding)) {
					retainedBindingsChanged = true;
				}
				nextBindings.set(placement.key, binding);
			}
		}
		return { bindings: nextBindings, retainedBindingsChanged };
	}

	#releaseSupersededPages(
		oldPages: readonly PublishedAtlasPage[],
		nextPages: ReadonlyMap<AtlasPageId, PublishedAtlasPage>,
	): void {
		for (const page of oldPages) {
			if (page.resource === nextPages.get(page.layout.pageId)?.resource)
				continue;
			if (!this.#renderResources.releaseResource(page.resource)) {
				throw new Error(
					`Resident atlas lost superseded page ${page.layout.pageId}.`,
				);
			}
			this.#recordPageRelease(page.layout);
		}
	}

	destroy(): void {
		for (const page of this.#pages.values()) {
			if (!this.#renderResources.releaseResource(page.resource)) {
				throw new Error(
					`Resident atlas lost page ${page.layout.pageId} during shutdown.`,
				);
			}
			this.#recordPageRelease(page.layout);
		}
		this.#pages.clear();
		this.#bindings.clear();
	}

	#activePageBytes(): number {
		return [...this.#pages.values()].reduce(
			(total, page) =>
				total + pageByteLength(page.layout.purpose, this.#pageSize),
			0,
		);
	}

	#recordPageRelease(page: AtlasPageLayout): void {
		this.#releasedPageCount += 1;
		this.#releasedPageBytes += pageByteLength(page.purpose, this.#pageSize);
	}
}

/** Resource replacement invalidates cached device handles even when the rectangle stays put. */
function sameBinding(
	left: TextureAtlasBinding,
	right: TextureAtlasBinding,
): boolean {
	const a = left.placement;
	const b = right.placement;
	return (
		left.resource === right.resource &&
		a.bounds.min.x === b.bounds.min.x &&
		a.bounds.min.y === b.bounds.min.y &&
		a.bounds.max.x === b.bounds.max.x &&
		a.bounds.max.y === b.bounds.max.y &&
		a.preparation.gutterPixels === b.preparation.gutterPixels &&
		a.preparation.wrap === b.preparation.wrap
	);
}

function pageDiagnostics(
	layout: AtlasPageLayout,
	pageSize: number,
): TextureAtlasPageDiagnostics {
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
		const bounds = allocationBoundsForPlacement(layout.purpose, placement);
		return total + bounds.width * bounds.height;
	}, 0);
	const largestFreeArea = reconstructFreeRectangles(layout, pageSize).reduce(
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
}

function pageByteLength(
	purpose: PackedObjectTexturePurpose,
	pageSize: number,
): number {
	const purposePolicy = texturePurposePolicy(purpose);
	return textureMipChainByteLength({
		format: purposePolicy.format,
		height: pageSize,
		mipLevels: texturePurposeMipLevelCount(purpose, pageSize, pageSize),
		width: pageSize,
	});
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
