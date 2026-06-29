import { describe, expect, it } from "vitest";
import type {
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "./contracts";
import {
	createLayerOwnerTargetedStaticResolverJob,
	TemporaryLayerOwnerTargetingResolverAdapter,
	type LayerOwnerTargetedStaticResolverJob,
} from "./layer-owner-source-adapter";

describe("temporary layer owner source adapter", () => {
	it("translates split domain resolver jobs to target owner keys", () => {
		expect(
			createLayerOwnerTargetedStaticResolverJob(
				createJob("outdoor-explicit-objects"),
			).targetOwnerKey,
		).toEqual({
			kind: "outdoor-explicit-objects",
			landblockId: 0xda55ffff,
		});
		expect(
			createLayerOwnerTargetedStaticResolverJob(
				createJob("outdoor-generated-scenery"),
			).targetOwnerKey,
		).toEqual({
			kind: "outdoor-generated-scenery",
			landblockId: 0xda55ffff,
		});
		expect(
			createLayerOwnerTargetedStaticResolverJob(
				createJob("landblock-env-cells"),
			).targetOwnerKey,
		).toEqual({
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		});
	});

	it("delegates resolution while publishing owner-targeted jobs", async () => {
		const resolver = new RecordingResolver();
		const targetedJobs: LayerOwnerTargetedStaticResolverJob[] = [];
		const adapter = new TemporaryLayerOwnerTargetingResolverAdapter({
			listener: (job) => targetedJobs.push(job),
			resolver,
		});
		const job = createJob("outdoor-generated-scenery");

		await expect(adapter.resolve(job)).resolves.toEqual({
			job,
			scope: { kind: "placeholder", referencedTextureUses: [] },
			sourceRevision: 7,
		});
		expect(resolver.jobs).toEqual([job]);
		expect(targetedJobs).toEqual([
			{
				job,
				targetOwnerKey: {
					kind: "outdoor-generated-scenery",
					landblockId: 0xda55ffff,
				},
			},
		]);
	});
});

function createJob(domain: StaticResolverJob["domain"]): StaticResolverJob {
	return {
		domain,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

class RecordingResolver implements StaticResolver {
	readonly jobs: StaticResolverJob[] = [];

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		this.jobs.push(job);
		return Promise.resolve({
			job,
			scope: { kind: "placeholder", referencedTextureUses: [] },
			sourceRevision: 7,
		});
	}
}
