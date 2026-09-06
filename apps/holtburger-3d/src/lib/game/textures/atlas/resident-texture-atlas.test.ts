import { describe, expect, it, vi } from "vitest";
import type { SceneInterestRevision } from "../../runtime/scene-availability";
import type { RenderGeometryData } from "../../renderer/geometry";
import type {
	GeometryResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DRegionUpload,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../../renderer/resource-manager";
import type { AssetTextureSource } from "../texture-manager";
import type { TexturePreparer } from "../texture-preparer";
import {
	createAssetTextureKey,
	packedObjectTexturePreparation,
	type AssetTextureFact,
	textureMipChainByteLength,
	texturePurposeMipLevelCount,
	TexturePixelFormat,
	TexturePurpose,
} from "../types";
import {
	classifyAtlasPageDisposition,
	type ResidentAtlasLayoutPlanner,
	type ResidentAtlasPageBuilder,
	ResidentTextureAtlas,
} from "./resident-texture-atlas";
import {
	createAtlasPageId,
	planStableAtlasLayout,
	type AtlasPageLayout,
} from "./layout";
import {
	buildAtlasPage,
	buildAtlasPagePatch,
	type AtlasPageBuildJob,
	type AtlasPageBuildResult,
	type AtlasPagePatchJob,
	type AtlasPagePatchResult,
} from "./page-build";

const DIRECT_COLOR = fact(TexturePurpose.ObjectDirectColor, "0x06000001");
const SECOND_DIRECT = fact(TexturePurpose.ObjectDirectColor, "0x06000003");
const INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000002");
const SECOND_INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000004");
const THIRD_INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000005");
const FIXTURE_SOURCE_SIZE = 1;
const FIXTURE_DIRECT_COLOR_GUTTER = packedObjectTexturePreparation(
	TexturePurpose.ObjectDirectColor,
).gutterPixels;
const FIXTURE_PAGE_SIZE =
	2 **
	Math.ceil(Math.log2(FIXTURE_SOURCE_SIZE + FIXTURE_DIRECT_COLOR_GUTTER * 2));

describe("ResidentTextureAtlas", () => {
	it("retains shared residency when only the buildings owner is withdrawn", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"buildings" | "objects">(preparer);
		const buildings = atlas.prepareOwnerRequirements("buildings", revision(1), [
			DIRECT_COLOR,
		]);
		const objects = atlas.prepareOwnerRequirements("objects", revision(1), [
			DIRECT_COLOR,
		]);

		expect(preparer.requests).toEqual([DIRECT_COLOR]);
		preparer.resolve(DIRECT_COLOR);
		await expect(buildings.completion).resolves.toBe("ready");
		await expect(objects.completion).resolves.toBe("ready");
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);

		atlas.withdrawOwnerRevision(buildings);
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		atlas.withdrawOwnerRevision(objects);
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
		expect(atlas.getDiagnostics()).toMatchObject({
			claimedTextureCount: 0,
			residentSourceCount: 0,
		});
	});

	it("retains the published revision until explicit replacement activation", async () => {
		const preparer = new ImmediatePreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const current = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		await current.completion;
		atlas.activateOwnerRevision(current);
		const replacement = atlas.prepareOwnerRequirements(
			"building",
			revision(2),
			[INDEX8],
		);
		await replacement.completion;

		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		expect(atlas.getPreparedSource(INDEX8.key)).toEqual(source(INDEX8));
		atlas.activateOwnerRevision(replacement);
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
		expect(atlas.getPreparedSource(INDEX8.key)).toEqual(source(INDEX8));
	});

	it("keeps a committed replacement when old-page retirement fails", async () => {
		const planner = new ArmableFailingLayoutPlanner(FIXTURE_PAGE_SIZE);
		const resources = new FixtureRendererResources();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const current = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		await expect(current.completion).resolves.toBe("ready");
		await atlas.activateOwnerRevision(current);
		const replacement = atlas.prepareOwnerRequirements(
			"building",
			revision(2),
			[SECOND_DIRECT],
		);
		await expect(replacement.completion).resolves.toBe("ready");
		planner.failSubsequentPlans();

		await expect(atlas.activateOwnerRevision(replacement)).resolves.toBe(
			undefined,
		);

		expect(atlas.getPreparedSource(SECOND_DIRECT.key)).toEqual(
			source(SECOND_DIRECT),
		);
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
		expect(atlas.getAtlasBinding(SECOND_DIRECT.key)).not.toBeNull();
		expect(atlas.getDiagnostics().failedTransactionCount).toBeGreaterThan(0);
		expect(atlas.getDiagnostics().publishedOwnerCount).toBe(1);
	});

	it("cannot let stale cleanup remove a newer same-owner revision", async () => {
		const preparer = new ImmediatePreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const stale = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		const current = atlas.prepareOwnerRequirements("building", revision(2), [
			DIRECT_COLOR,
		]);
		await Promise.all([stale.completion, current.completion]);

		atlas.withdrawOwnerRevision(stale);
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		atlas.activateOwnerRevision(current);
		expect(atlas.getDiagnostics().publishedOwnerCount).toBe(1);
	});

	it("withdraws a pending revision without retaining its late result", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const pending = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		atlas.withdrawOwnerRevision(pending);
		await expect(pending.completion).resolves.toBe("withdrawn");
		preparer.resolve(DIRECT_COLOR);
		await Promise.resolve();

		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
	});

	it("fails one provisional revision without disturbing another owner claim", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"first" | "second">(preparer);
		const failed = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		const surviving = atlas.prepareOwnerRequirements("second", revision(1), [
			INDEX8,
		]);

		const failure = new Error("preparation failed");
		preparer.reject(DIRECT_COLOR, failure);
		preparer.resolve(INDEX8);
		await expect(failed.completion).resolves.toEqual({
			cause: failure,
			kind: "failed",
		});
		await expect(surviving.completion).resolves.toBe("ready");
		expect(atlas.getDiagnostics()).toMatchObject({
			claimedTextureCount: 1,
			residentSourceCount: 1,
		});
	});

	it("returns one handle for an identical revision and rejects a conflicting fact set", () => {
		const atlas = new ResidentTextureAtlas<"building">(new DeferredPreparer());
		const first = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);

		expect(
			atlas.prepareOwnerRequirements("building", revision(1), [DIRECT_COLOR]),
		).toBe(first);
		expect(() =>
			atlas.prepareOwnerRequirements("building", revision(1), [INDEX8]),
		).toThrow("conflicting texture facts");
	});

	it("evicts only the authoritative owner revisions and settles pending handles on destroy", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"first" | "second">(preparer);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			DIRECT_COLOR,
		]);

		atlas.evictOwnerRequirements("first", revision(1));
		atlas.evictOwnerRequirements("first", revision(1));
		await expect(first.completion).resolves.toBe("withdrawn");
		preparer.resolve(DIRECT_COLOR);
		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);

		const pending = atlas.prepareOwnerRequirements("first", revision(2), [
			INDEX8,
		]);
		atlas.destroy();
		await expect(pending.completion).resolves.toBe("withdrawn");
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
	});

	it("publishes and releases a physical page without transferring its retained source", async () => {
		const resources = new FixtureRendererResources();
		const onRetainedBindingsChanged = vi.fn();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);

		await expect(handle.completion).resolves.toBe("ready");
		const binding = atlas.getAtlasBinding(DIRECT_COLOR.key);
		expect(binding).not.toBeNull();
		expect(resources.uploads).toHaveLength(1);
		expect(binding!.placement.bounds.min).toMatchObject({
			x: FIXTURE_DIRECT_COLOR_GUTTER,
			y: FIXTURE_DIRECT_COLOR_GUTTER,
		});
		const sourcePixelOffset =
			(FIXTURE_DIRECT_COLOR_GUTTER * FIXTURE_PAGE_SIZE +
				FIXTURE_DIRECT_COLOR_GUTTER) *
			4;
		expect(
			resources.uploads[0]?.data.slice(
				sourcePixelOffset,
				sourcePixelOffset + 4,
			),
		).toEqual(Uint8Array.of(1, 2, 3, 4));
		expect(atlas.getPreparedSource(DIRECT_COLOR.key).pixels).toEqual(
			source(DIRECT_COLOR).pixels,
		);
		const mipLevels = texturePurposeMipLevelCount(
			TexturePurpose.ObjectDirectColor,
			FIXTURE_PAGE_SIZE,
			FIXTURE_PAGE_SIZE,
		);
		const devicePageBytes = textureMipChainByteLength({
			format: TexturePixelFormat.RGBA8,
			height: FIXTURE_PAGE_SIZE,
			mipLevels,
			width: FIXTURE_PAGE_SIZE,
		});
		const allocationSize =
			FIXTURE_SOURCE_SIZE + FIXTURE_DIRECT_COLOR_GUTTER * 2;
		expect(resources.uploads[0]?.mipLevels).toBe(mipLevels);
		expect(atlas.getAtlasPageDiagnostics()[0]).toMatchObject({
			allocatedPixelRatio: allocationSize ** 2 / FIXTURE_PAGE_SIZE ** 2,
			byteLength: devicePageBytes,
			height: FIXTURE_PAGE_SIZE,
			occupiedPixelRatio: FIXTURE_SOURCE_SIZE ** 2 / FIXTURE_PAGE_SIZE ** 2,
			width: FIXTURE_PAGE_SIZE,
		});
		expect(atlas.getDiagnostics()).toMatchObject({
			copiedSourceBytes: 4,
			peakPageBytes: devicePageBytes,
			uploadedPageBytes: FIXTURE_PAGE_SIZE ** 2 * 4,
			uploadedPageCount: 1,
		});

		await atlas.withdrawOwnerRevision(handle);
		expect(onRetainedBindingsChanged).not.toHaveBeenCalled();
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
		expect(resources.released).toEqual([binding!.resource]);
		expect(atlas.getDiagnostics()).toMatchObject({
			activePageBytes: 0,
			releasedPageBytes: devicePageBytes,
			releasedPageCount: 1,
		});
	});

	it("does not plan or rebuild when a second owner only claims an existing resident binding", async () => {
		const planner = new CountingLayoutPlanner(FIXTURE_PAGE_SIZE);
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const planCount = planner.planCount;

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		expect(planner.planCount).toBe(planCount);
		expect(atlas.getDiagnostics().avoidedPreparationCount).toBe(1);
	});

	it("never reuses a released page generation for a later requirement", async () => {
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		await first.completion;
		const firstPageId = atlas.getAtlasPageDiagnostics()[0]!.pageId;

		await atlas.withdrawOwnerRevision(first);
		expect(atlas.getAtlasPageDiagnostics()).toEqual([]);

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			DIRECT_COLOR,
		]);
		await second.completion;
		expect(atlas.getAtlasPageDiagnostics()[0]!.pageId).not.toBe(firstPageId);
	});

	it("preserves retained bindings across releases and insertion patches", async () => {
		const resources = new FixtureRendererResources();
		const onRetainedBindingsChanged = vi.fn();
		const atlas = new ResidentTextureAtlas<"first" | "second" | "third">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const originalBinding = atlas.getAtlasBinding(INDEX8.key);
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);
		await second.completion;
		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(1);
		const retainedResource = atlas.getAtlasBinding(INDEX8.key)!.resource;
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)!.resource).toBe(
			retainedResource,
		);
		const uploadsBeforeRelease = resources.uploads.length;
		const releasedBeforeRelease = [...resources.released];
		const releasedPagesBeforeRelease = atlas.getDiagnostics().releasedPageCount;
		const patchedPagesBeforeRelease = atlas.getDiagnostics().patchedPageCount;

		await atlas.withdrawOwnerRevision(second);
		expect(resources.uploads).toHaveLength(uploadsBeforeRelease);
		expect(resources.released).toEqual(releasedBeforeRelease);
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)).toBeNull();
		expect(atlas.getAtlasBinding(INDEX8.key)!.resource).toBe(retainedResource);
		expect(atlas.getDiagnostics()).toMatchObject({
			metadataOnlyPageUpdateCount: 1,
			releasedPageCount: releasedPagesBeforeRelease,
		});

		const third = atlas.prepareOwnerRequirements("third", revision(1), [
			THIRD_INDEX8,
		]);
		await expect(third.completion).resolves.toBe("ready");
		// The freed region is reused by a patch, so the page is never republished whole.
		expect(resources.uploads).toHaveLength(uploadsBeforeRelease);
		expect(resources.released).toEqual(releasedBeforeRelease);
		expect(atlas.getAtlasBinding(THIRD_INDEX8.key)!.resource).toBe(
			retainedResource,
		);
		expect(atlas.getAtlasBinding(INDEX8.key)!.resource).toBe(retainedResource);
		expect(atlas.getDiagnostics()).toMatchObject({
			metadataOnlyPageUpdateCount: 1,
			patchedPageCount: patchedPagesBeforeRelease + 1,
		});
		expect(atlas.getAtlasBinding(INDEX8.key)).toEqual(originalBinding);
		expect(onRetainedBindingsChanged).not.toHaveBeenCalled();
	});

	it("patches a page to exactly the pixels a whole-page rebuild produces", async () => {
		// Wide enough for two gutter-bearing direct-color allocations, so the second insertion
		// lands on the first page and exercises patching rather than page creation.
		const pageSize = 64;
		const patchedResources = new FixtureRendererResources();
		const patched = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new SizedLayoutPlanner(pageSize),
				pageBuilder: new FixturePageBuilder(),
				pageSize,
				renderResources: patchedResources,
			},
		);
		const first = patched.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		await first.completion;
		const pageResource = patched.getAtlasBinding(DIRECT_COLOR.key)!.resource;
		const second = patched.prepareOwnerRequirements("second", revision(1), [
			SECOND_DIRECT,
		]);
		await expect(second.completion).resolves.toBe("ready");
		expect(patched.getAtlasBinding(SECOND_DIRECT.key)!.resource).toBe(
			pageResource,
		);
		expect(patched.getDiagnostics()).toMatchObject({ patchedPageCount: 1 });

		const rebuiltResources = new FixtureRendererResources();
		const rebuilt = new ResidentTextureAtlas<"both">(new ImmediatePreparer(), {
			layoutPlanner: new SizedLayoutPlanner(pageSize),
			pageBuilder: new FixturePageBuilder(),
			pageSize,
			renderResources: rebuiltResources,
		});
		const both = rebuilt.prepareOwnerRequirements("both", revision(1), [
			DIRECT_COLOR,
			SECOND_DIRECT,
		]);
		await expect(both.completion).resolves.toBe("ready");
		const rebuiltResource = rebuilt.getAtlasBinding(DIRECT_COLOR.key)!.resource;

		expect(patched.getAtlasPageDiagnostics()).toEqual(
			rebuilt.getAtlasPageDiagnostics(),
		);
		expect(patchedResources.pixelsOf(pageResource)).toEqual(
			rebuiltResources.pixelsOf(rebuiltResource),
		);
	});

	it("republishes whole pages when a patch cannot be built", async () => {
		const pageBuilder = new FailingPatchPageBuilder();
		const resources = new FixtureRendererResources();
		const onRetainedBindingsChanged = vi.fn(() =>
			atlas.getAtlasBinding(INDEX8.key),
		);
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder,
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const originalResource = atlas.getAtlasBinding(INDEX8.key)!.resource;
		const originalPlacement = atlas.getAtlasBinding(INDEX8.key)!.placement;

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		expect(pageBuilder.patchAttempts).toBe(1);
		expect(atlas.getDiagnostics()).toMatchObject({
			patchFallbackCount: 1,
			patchedPageCount: 0,
		});
		// The fallback rebuild republishes the page, so both keys bind to a fresh resource.
		const rebuiltResource = atlas.getAtlasBinding(INDEX8.key)!.resource;
		expect(rebuiltResource).not.toBe(originalResource);
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)!.resource).toBe(
			rebuiltResource,
		);
		expect(resources.released).toContain(originalResource);
		expect(atlas.getAtlasBinding(INDEX8.key)!.placement).toEqual(
			originalPlacement,
		);
		expect(onRetainedBindingsChanged).toHaveBeenCalledTimes(1);
		// Consumers observe the committed replacement, never the obsolete physical handle.
		expect(onRetainedBindingsChanged).toHaveReturnedWith(
			atlas.getAtlasBinding(INDEX8.key),
		);
	});

	it("does not plan a compaction for a layout that cannot occupy fewer pages", async () => {
		const planner = new CountingLayoutPlanner(FIXTURE_PAGE_SIZE);
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const plansAfterFirst = planner.planCount;

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		// Both keys share one page, so no packing can use fewer: the stable plan is the only one.
		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(1);
		expect(planner.planCount).toBe(plansAfterFirst + 1);
		expect(atlas.getDiagnostics().compactionAttemptCount).toBe(0);
	});

	it("accepts a bounded compaction only when it eliminates a page", async () => {
		const resources = new FixtureRendererResources();
		const onRetainedBindingsChanged = vi.fn();
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new FragmentingLayoutPlanner(),
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(1);
		expect(atlas.getAtlasBinding(INDEX8.key)).not.toBeNull();
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)).not.toBeNull();
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
		expect(onRetainedBindingsChanged).toHaveBeenCalledTimes(1);
		expect(atlas.getDiagnostics()).toMatchObject({
			acceptedCompactionCount: 1,
			eliminatedPageCount: 1,
			failedCompactionCount: 0,
		});
	});

	it("falls back to stable insertion when optional compaction page building fails", async () => {
		const onRetainedBindingsChanged = vi.fn();
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new FragmentingLayoutPlanner(),
				pageBuilder: new FailingCompactPageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);

		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(2);
		expect(atlas.getAtlasBinding(INDEX8.key)).not.toBeNull();
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)).not.toBeNull();
		expect(atlas.getDiagnostics().failedCompactionCount).toBe(1);
		expect(onRetainedBindingsChanged).not.toHaveBeenCalled();
	});

	it("rolls back all new resources when a multi-page publication fails", async () => {
		const resources = new FixtureRendererResources(2);
		const onRetainedBindingsChanged = vi.fn();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				onRetainedBindingsChanged,
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
			SECOND_DIRECT,
		]);

		await expect(handle.completion).resolves.toMatchObject({
			cause: expect.anything(),
			kind: "failed",
		});
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
		expect(atlas.getAtlasBinding(SECOND_DIRECT.key)).toBeNull();
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
		expect(atlas.getDiagnostics()).toMatchObject({
			failedTransactionCount: 1,
			releasedPageCount: 1,
			uploadedPageCount: 1,
		});
		expect(onRetainedBindingsChanged).not.toHaveBeenCalled();
	});

	it("rejects a stale layout result without publishing its withdrawn requirement", async () => {
		const planner = new DeferredFirstLayoutPlanner();
		const resources = new FixtureRendererResources();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		await planner.firstRequest;

		const withdrawal = atlas.withdrawOwnerRevision(handle);
		planner.resolveFirst();
		await withdrawal;
		await expect(handle.completion).resolves.toBe("withdrawn");
		expect(resources.uploads).toEqual([]);
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
		expect(atlas.getDiagnostics().staleTransactionCount).toBe(1);
	});

	it("does not reuse page generations when purpose state changes during publication", async () => {
		const pageBuilder = new DeferredFirstPageBuilder();
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new SizedLayoutPlanner(FIXTURE_PAGE_SIZE),
				pageBuilder,
				pageSize: FIXTURE_PAGE_SIZE,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		await pageBuilder.firstBuildStarted;

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_DIRECT,
		]);
		await Promise.resolve();
		expect(atlas.getPreparedSource(SECOND_DIRECT.key)).toEqual(
			source(SECOND_DIRECT),
		);
		pageBuilder.resolveFirst();

		await expect(first.completion).resolves.toBe("ready");
		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).not.toBeNull();
		expect(atlas.getAtlasBinding(SECOND_DIRECT.key)).not.toBeNull();
		expect(atlas.getAtlasPageDiagnostics().map(({ pageId }) => pageId)).toEqual(
			[
				createAtlasPageId(TexturePurpose.ObjectDirectColor, 0),
				createAtlasPageId(TexturePurpose.ObjectDirectColor, 1),
			],
		);
		expect(atlas.getDiagnostics()).toMatchObject({
			failedTransactionCount: 0,
			staleTransactionCount: 1,
		});
	});
});

describe("classifyAtlasPageDisposition", () => {
	const purpose = TexturePurpose.ObjectIndex8;
	const placed = (
		key: AssetTextureFact["key"],
		x: number,
	): AtlasPageLayout["placements"][number] => ({
		contentBounds: { height: 1, width: 1, x, y: 0 },
		key,
	});
	const layout = (
		...placements: AtlasPageLayout["placements"]
	): AtlasPageLayout => ({
		pageId: createAtlasPageId(purpose, 0),
		placements,
		purpose,
	});

	it("builds a page that has never been published", () => {
		expect(
			classifyAtlasPageDisposition(
				undefined,
				layout(placed(INDEX8.key, 0)),
				new Set([INDEX8.key]),
			),
		).toEqual({ kind: "build" });
	});

	it("does nothing when published pixels and metadata already match", () => {
		const published = layout(placed(INDEX8.key, 0));
		expect(
			classifyAtlasPageDisposition(published, published, new Set()),
		).toEqual({ kind: "unchanged" });
	});

	it("swaps metadata only when placements were released", () => {
		expect(
			classifyAtlasPageDisposition(
				layout(placed(INDEX8.key, 0), placed(SECOND_INDEX8.key, 1)),
				layout(placed(INDEX8.key, 0)),
				new Set(),
			),
		).toEqual({ kind: "metadata-only" });
	});

	it("patches the inserted keys of a page whose retained placements held still", () => {
		expect(
			classifyAtlasPageDisposition(
				layout(placed(INDEX8.key, 0)),
				layout(placed(INDEX8.key, 0), placed(SECOND_INDEX8.key, 1)),
				new Set([SECOND_INDEX8.key]),
			),
		).toEqual({ insertedKeys: [SECOND_INDEX8.key], kind: "patch" });
	});

	it("rebuilds when a retained placement moved", () => {
		expect(
			classifyAtlasPageDisposition(
				layout(placed(INDEX8.key, 0)),
				layout(placed(INDEX8.key, 2)),
				new Set(),
			),
		).toEqual({ kind: "build" });
	});

	it("rebuilds when an unfamiliar key appears without being planned as an insertion", () => {
		expect(
			classifyAtlasPageDisposition(
				layout(placed(INDEX8.key, 0)),
				layout(placed(INDEX8.key, 0), placed(SECOND_INDEX8.key, 1)),
				new Set(),
			),
		).toEqual({ kind: "build" });
	});
});

function fact(
	purpose: TexturePurpose.ObjectDirectColor | TexturePurpose.ObjectIndex8,
	sourceAssetId: `0x${string}`,
): AssetTextureFact {
	return {
		kind: "asset",
		key: createAssetTextureKey(purpose, sourceAssetId),
		purpose,
		sourceAssetId,
	};
}

function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

/** Distinct per-asset pixels, so a misplaced patch cannot compare equal to a correct one. */
function source(fact: AssetTextureFact): AssetTextureSource {
	const seed = Number.parseInt(fact.sourceAssetId.slice(-1), 16);
	return {
		height: 1,
		key: fact.key,
		pixels: new Uint8Array(
			fact.purpose === TexturePurpose.ObjectDirectColor
				? [seed, seed + 1, seed + 2, seed + 3]
				: [seed],
		),
		purpose: fact.purpose,
		sourceAssetId: fact.sourceAssetId,
		width: 1,
	};
}

class DeferredPreparer implements TexturePreparer {
	readonly requests: AssetTextureFact[] = [];
	readonly #deferred = new Map<
		AssetTextureFact["key"],
		{
			readonly reject: (cause: unknown) => void;
			readonly resolve: () => void;
			readonly promise: Promise<AssetTextureSource>;
		}
	>();

	prepare(fact: AssetTextureFact): Promise<AssetTextureSource> {
		this.requests.push(fact);
		let resolve!: () => void;
		let reject!: (cause: unknown) => void;
		const promise = new Promise<AssetTextureSource>((accept, fail) => {
			resolve = () => accept(source(fact));
			reject = (cause) => fail(cause);
		});
		this.#deferred.set(fact.key, { promise, reject, resolve });
		return promise;
	}

	async destroy(): Promise<void> {}

	resolve(fact: AssetTextureFact): void {
		const deferred = this.#deferred.get(fact.key);
		if (!deferred) throw new Error(`No pending preparation for ${fact.key}.`);
		deferred.resolve();
	}

	reject(
		fact: AssetTextureFact,
		cause = new Error(`Failed ${fact.key}.`),
	): void {
		const deferred = this.#deferred.get(fact.key);
		if (!deferred) throw new Error(`No pending preparation for ${fact.key}.`);
		deferred.reject(cause);
	}
}

class ImmediatePreparer implements TexturePreparer {
	async prepare(fact: AssetTextureFact): Promise<AssetTextureSource> {
		return source(fact);
	}

	async destroy(): Promise<void> {}
}

class SizedLayoutPlanner implements ResidentAtlasLayoutPlanner {
	readonly #pageSize: number;

	constructor(pageSize: number) {
		this.#pageSize = pageSize;
	}

	destroy(): void {}

	async plan(request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0]) {
		return planStableAtlasLayout(request, { pageSize: this.#pageSize });
	}
}

class CountingLayoutPlanner extends SizedLayoutPlanner {
	planCount = 0;

	override async plan(
		request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0],
	) {
		this.planCount += 1;
		return super.plan(request);
	}
}

class ArmableFailingLayoutPlanner extends SizedLayoutPlanner {
	#fail = false;

	override plan(request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0]) {
		if (this.#fail) {
			return Promise.reject(new Error("Synthetic retirement-layout failure."));
		}
		return super.plan(request);
	}

	failSubsequentPlans(): void {
		this.#fail = true;
	}
}

/** Deliberately models two fragmented index pages so the resident transaction can prove compaction. */
class FragmentingLayoutPlanner implements ResidentAtlasLayoutPlanner {
	destroy(): void {}

	async plan(request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0]) {
		if (
			!request.correlationId.endsWith(":compact") &&
			request.entries.length === 2
		) {
			return {
				correlationId: request.correlationId,
				insertedKeys: [request.entries[1]!.key],
				pageSize: FIXTURE_PAGE_SIZE,
				pages: request.entries.map((entry, index) => ({
					pageId: createAtlasPageId(request.purpose, index),
					placements: [
						{
							contentBounds: { height: 1, width: 1, x: 0, y: 0 },
							key: entry.key,
						},
					],
					purpose: request.purpose,
				})),
				purpose: request.purpose,
				releasedKeys: [],
			};
		}
		return planStableAtlasLayout(request, { pageSize: FIXTURE_PAGE_SIZE });
	}
}

class DeferredFirstLayoutPlanner implements ResidentAtlasLayoutPlanner {
	readonly firstRequest: Promise<void>;
	#resolveFirstRequest!: () => void;
	#resolvePlan: (() => void) | null = null;
	#requests = 0;

	constructor() {
		this.firstRequest = new Promise<void>((resolve) => {
			this.#resolveFirstRequest = resolve;
		});
	}

	destroy(): void {}

	plan(
		request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0],
	): Promise<ReturnType<typeof planStableAtlasLayout>> {
		this.#requests += 1;
		if (this.#requests > 1) {
			return Promise.resolve(
				planStableAtlasLayout(request, { pageSize: FIXTURE_PAGE_SIZE }),
			);
		}
		this.#resolveFirstRequest();
		return new Promise((resolve) => {
			this.#resolvePlan = () =>
				resolve(
					planStableAtlasLayout(request, { pageSize: FIXTURE_PAGE_SIZE }),
				);
		});
	}

	resolveFirst(): void {
		if (!this.#resolvePlan)
			throw new Error("First layout request was not pending.");
		this.#resolvePlan();
		this.#resolvePlan = null;
	}
}

class FixturePageBuilder implements ResidentAtlasPageBuilder {
	build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult> {
		void transfer;
		return Promise.resolve(buildAtlasPage(job));
	}

	patch(
		job: AtlasPagePatchJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPagePatchResult> {
		void transfer;
		return Promise.resolve(buildAtlasPagePatch(job));
	}

	destroy(): void {}
}

/** Page builder whose patches always fail, exercising the whole-page rebuild fallback. */
class FailingPatchPageBuilder extends FixturePageBuilder {
	patchAttempts = 0;

	override patch(
		job: AtlasPagePatchJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPagePatchResult> {
		void job;
		void transfer;
		this.patchAttempts += 1;
		return Promise.reject(new Error("Synthetic patch failure."));
	}
}

class DeferredFirstPageBuilder implements ResidentAtlasPageBuilder {
	readonly firstBuildStarted: Promise<void>;
	#markFirstBuildStarted!: () => void;
	#resolveFirstBuild: (() => void) | null = null;
	#buildCount = 0;

	constructor() {
		this.firstBuildStarted = new Promise<void>((resolve) => {
			this.#markFirstBuildStarted = resolve;
		});
	}

	build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult> {
		void transfer;
		this.#buildCount += 1;
		if (this.#buildCount > 1) return Promise.resolve(buildAtlasPage(job));
		this.#markFirstBuildStarted();
		return new Promise((resolve) => {
			this.#resolveFirstBuild = () => resolve(buildAtlasPage(job));
		});
	}

	patch(
		job: AtlasPagePatchJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPagePatchResult> {
		void transfer;
		return Promise.resolve(buildAtlasPagePatch(job));
	}

	destroy(): void {}

	resolveFirst(): void {
		if (!this.#resolveFirstBuild)
			throw new Error("First atlas page build was not pending.");
		this.#resolveFirstBuild();
		this.#resolveFirstBuild = null;
	}
}

class FailingCompactPageBuilder extends FixturePageBuilder {
	override build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult> {
		if (job.page.pageId.endsWith(":2")) {
			return Promise.reject(new Error("Synthetic compact-page failure."));
		}
		return super.build(job, transfer);
	}
}

class FixtureRendererResources implements RendererResourceManager {
	readonly uploads: Texture2DUpload[] = [];
	readonly released: RenderResourceKey[] = [];
	/** Live device state per texture, so region writes are observable like a real device. */
	readonly #textures = new Map<
		Texture2DResourceKey,
		{
			readonly bytesPerTexel: number;
			readonly pixels: Uint8Array;
			readonly width: number;
		}
	>();
	readonly #failOnCreate: number | null;
	#next = 0;

	constructor(failOnCreate: number | null = null) {
		this.#failOnCreate = failOnCreate;
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		if (this.#next + 1 === this.#failOnCreate) {
			throw new Error("Synthetic page upload failure.");
		}
		this.uploads.push(upload);
		const resource =
			`texture-2d-resource:${this.#next}` as Texture2DResourceKey;
		this.#next += 1;
		if (!(upload.data instanceof Uint8Array)) {
			throw new Error("Fixture textures are normalized byte textures.");
		}
		this.#textures.set(resource, {
			bytesPerTexel: upload.data.byteLength / (upload.width * upload.height),
			pixels: Uint8Array.from(upload.data),
			width: upload.width,
		});
		return resource;
	}

	/** Current device bytes for one texture, for exact patch-versus-rebuild comparison. */
	pixelsOf(key: Texture2DResourceKey): Uint8Array {
		return this.#requireTexture(key).pixels;
	}

	updateTexture2DRegions(
		key: Texture2DResourceKey,
		regions: readonly Texture2DRegionUpload[],
	): void {
		const { bytesPerTexel, pixels, width } = this.#requireTexture(key);
		for (const region of regions) {
			if (!(region.data instanceof Uint8Array)) {
				throw new Error("Fixture regions are normalized byte regions.");
			}
			for (let row = 0; row < region.height; row += 1) {
				const source = row * region.width * bytesPerTexel;
				const destination =
					((region.y + row) * width + region.x) * bytesPerTexel;
				pixels.set(
					region.data.subarray(source, source + region.width * bytesPerTexel),
					destination,
				);
			}
		}
	}

	#requireTexture(key: Texture2DResourceKey) {
		const texture = this.#textures.get(key);
		if (!texture) throw new Error(`Fixture texture ${key} does not exist.`);
		return texture;
	}

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		throw new Error("Geometry is outside this fixture.");
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
		throw new Error("Geometry is outside this fixture.");
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
		throw new Error("Texture replacement is outside this fixture.");
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		throw new Error("Texture arrays are outside this fixture.");
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		void key;
		void upload;
		throw new Error("Texture arrays are outside this fixture.");
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
		throw new Error("Texture arrays are outside this fixture.");
	}

	releaseResource(key: RenderResourceKey): boolean {
		this.released.push(key);
		return true;
	}

	async destroy(): Promise<void> {}
}
