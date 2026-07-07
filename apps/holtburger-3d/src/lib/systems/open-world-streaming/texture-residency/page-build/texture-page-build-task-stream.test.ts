import { describe, expect, it } from "vitest";

import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../../../static/contracts";
import { createOpenWorldTextureBucketKey } from "../claims/bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTextureBindingRequirement,
	type OpenWorldTexturePageReservationToken,
} from "../claims/texture-claim-registry";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
} from "./protocol";
import type { OpenWorldTexturePageBuilder } from "./worker-client";
import { OpenWorldTexturePageBuildTaskStream } from "./texture-page-build-task-stream";

describe("OpenWorldTexturePageBuildTaskStream", () => {
	it("settles accepted page builds into renderer texture commits", async () => {
		const fixture = createTextureTaskFixture();
		const commits: OpenWorldStreamingTextureCommit[] = [];
		const stream = new OpenWorldTexturePageBuildTaskStream({
			onCommit: (commit) => commits.push(commit),
			pageBuilder: new FixturePageBuilder(fixture.output),
			textureClaims: fixture.registry,
		});

		stream.schedule({
			isCurrent: () => true,
			ownerId: fixture.ownerId,
			pageBuildRequests: [fixture.input],
			sourceTaskId: "static-task:1",
		});
		await stream.waitForIdle();

		expect(commits).toHaveLength(1);
		expect(
			fixture.registry.createBucketSnapshot(fixture.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: null,
			state: "resident",
		});
		expect(stream.createDiagnosticsSnapshot().summary).toEqual({
			accepted: 1,
			active: 0,
			committed: 1,
			failed: 0,
			queued: 1,
			staleRejected: 0,
		});
	});

	it("retires stale owner outputs without publishing texture commits", async () => {
		const fixture = createTextureTaskFixture();
		const commits: OpenWorldStreamingTextureCommit[] = [];
		const stream = new OpenWorldTexturePageBuildTaskStream({
			onCommit: (commit) => commits.push(commit),
			pageBuilder: new FixturePageBuilder(fixture.output),
			textureClaims: fixture.registry,
		});

		stream.schedule({
			isCurrent: () => false,
			ownerId: fixture.ownerId,
			pageBuildRequests: [fixture.input],
			sourceTaskId: "static-task:stale",
		});
		await stream.waitForIdle();

		expect(commits).toEqual([]);
		expect(
			fixture.registry.createBucketSnapshot(fixture.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: null,
			state: "planned",
		});
		expect(stream.createDiagnosticsSnapshot().summary).toEqual({
			accepted: 0,
			active: 0,
			committed: 0,
			failed: 0,
			queued: 1,
			staleRejected: 1,
		});
	});

	it("publishes failed binding readiness when page builds throw", async () => {
		const fixture = createTextureTaskFixture();
		const commits: OpenWorldStreamingTextureCommit[] = [];
		const stream = new OpenWorldTexturePageBuildTaskStream({
			onCommit: (commit) => commits.push(commit),
			pageBuilder: new FailingPageBuilder(new Error("fixture build failed")),
			textureClaims: fixture.registry,
		});

		stream.schedule({
			isCurrent: () => true,
			ownerId: fixture.ownerId,
			pageBuildRequests: [fixture.input],
			sourceTaskId: "static-task:failed",
		});
		await stream.waitForIdle();

		expect(commits).toEqual([
			expect.objectContaining({
				bindingUpdates: [
					{
						bindingId: bindingId("binding:task-stream"),
						readiness: {
							kind: "failed",
							message: "fixture build failed",
						},
					},
				],
				bucketKey: fixture.bucketKey,
				kind: "texture-commit",
				pageUpdates: [],
			}),
		]);
		expect(
			fixture.registry.createBucketSnapshot(fixture.bucketKey).pages[0],
		).toMatchObject({
			reservationToken: null,
			state: "planned",
		});
		expect(stream.createDiagnosticsSnapshot()).toMatchObject({
			recent: [
				{
					error: "fixture build failed",
					status: "failed",
				},
			],
			summary: {
				accepted: 0,
				active: 0,
				committed: 0,
				failed: 1,
				queued: 1,
				staleRejected: 0,
			},
		});
	});
});

class FixturePageBuilder implements OpenWorldTexturePageBuilder {
	constructor(readonly output: OpenWorldTexturePageBuildOutput) {}

	async buildPage(): Promise<OpenWorldTexturePageBuildOutput> {
		return this.output;
	}
}

class FailingPageBuilder implements OpenWorldTexturePageBuilder {
	constructor(readonly error: Error) {}

	async buildPage(): Promise<OpenWorldTexturePageBuildOutput> {
		throw this.error;
	}
}

function createTextureTaskFixture(): {
	readonly bucketKey: ReturnType<typeof createBucketKey>;
	readonly input: OpenWorldTexturePageBuildInput;
	readonly output: OpenWorldTexturePageBuildOutput;
	readonly ownerId: MaterializationOwnerId;
	readonly registry: OpenWorldTextureClaimRegistry;
} {
	const registry = new OpenWorldTextureClaimRegistry();
	const bucketKey = createBucketKey();
	const ownerId = "owner:texture-task" as MaterializationOwnerId;
	const snapshot = registry.retainTextureBindings(ownerId, bucketKey, [
		createBinding(bucketKey),
	]);
	const page = registry.createPage({
		bucketKey,
		entryIds: [snapshot.entries[0].id],
	});
	const reservationToken = registry.reservePageBuild(page.id);
	const input = createPageBuildInput({ bucketKey, reservationToken });
	const output: OpenWorldTexturePageBuildOutput = {
		...input,
		kind: "page-update",
		page: {
			...input.page,
			pixels: new Uint8Array(4),
			textureRefId: "texture-ref:task-stream",
		},
		placements: [
			{
				bindingId: bindingId("binding:task-stream"),
				rect: [0, 0, 1, 1],
			},
		],
		stageTimings: [],
	};
	return {
		bucketKey,
		input,
		output,
		ownerId,
		registry,
	};
}

function createPageBuildInput(options: {
	readonly bucketKey: ReturnType<typeof createBucketKey>;
	readonly reservationToken: OpenWorldTexturePageReservationToken;
}): OpenWorldTexturePageBuildInput {
	return {
		bucketKey: options.bucketKey,
		entries: [
			{
				bindingIds: [bindingId("binding:task-stream")],
				dataUse: createTextureUse(),
				entryId:
					`${options.bucketKey}:entry:1` as OpenWorldTexturePageBuildInput["entries"][number]["entryId"],
				gutterEdgeMode: "clamp",
				gutterPixels: 0,
				rect: [0, 0, 1, 1],
			},
		],
		jobId: "texture-task:test",
		page: {
			anisotropy: 1,
			filteringMode: "nearest",
			format: "rgba8",
			height: 1,
			mipmapsGenerated: false,
			sampleClass: "rgba-color",
			samplerPolicyKey: "sampler:nearest",
			width: 1,
			wrapS: "clamp",
			wrapT: "clamp",
		},
		pageId:
			`${options.bucketKey}:page:1` as OpenWorldTexturePageBuildInput["pageId"],
		reservationToken: options.reservationToken,
	};
}

function createBinding(
	bucketKey: ReturnType<typeof createBucketKey>,
): OpenWorldTextureBindingRequirement {
	return {
		bindingId: bindingId("binding:task-stream"),
		bucketKey,
		pageClass: "page-class:task-stream" as TexturePageClass,
		purpose: "object-base-color",
		sourceKey: "source:task-stream",
		textureKey: "texture:task-stream" as TextureKey,
	};
}

function createBucketKey() {
	return createOpenWorldTextureBucketKey({
		domain: "test-domain",
		purpose: "object-base-color",
		scope: { kind: "static-domain" },
	});
}

function createTextureUse(): PreparedRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function bindingId(value: string): TextureBindingId {
	return value as TextureBindingId;
}
