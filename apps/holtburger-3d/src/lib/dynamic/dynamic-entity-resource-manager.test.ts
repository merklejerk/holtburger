import { describe, expect, it } from "vitest";
import { HostBackedAssetService } from "../assets/asset-service";
import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import type {
	RuntimeHost,
	RuntimeHostSnapshot,
} from "../host/runtime-contracts";
import type {
	StaticAuthoredDynamicSeedRecord,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import { DynamicEntityController } from "./dynamic-entity-controller";
import { DynamicEntityResourceManager } from "./dynamic-entity-resource-manager";

describe("dynamic entity resource manager", () => {
	it("marks outdoor and env-cell setup/animation resources ready through one path", async () => {
		const assetService = createAssetService();
		const controller = createController(assetService);

		controller.ingestStaticSeeds([
			createOutdoorSeedRecord(),
			createEnvCellDynamicSeedRecord(),
		]);
		await flushPromises();

		const records = controller.createSnapshot().records;
		expect(records).toHaveLength(2);
		expect(records.map((record) => record.resources.setupAnimation.status)).toEqual([
			"ready",
			"ready",
		]);
		expect(records.map((record) => record.animation.status)).toEqual([
			"ready",
			"ready",
		]);
		expect(records.map((record) => record.renderability.reasons)).toEqual([
			["visual-resources-pending", "residence-render-path-pending"],
			["visual-resources-pending"],
		]);
	});

	it("dedupes shared setup and animation host assets while holding per-entity leases", async () => {
		const host = new ResolvingRuntimeHost();
		const assetService = new HostBackedAssetService({ host });
		const controller = createController(assetService);

		controller.ingestStaticSeeds([
			createOutdoorSeedRecord({ instanceId: "windmill-0" }),
			createOutdoorSeedRecord({ instanceId: "windmill-1" }),
		]);
		await flushPromises();

		expect(host.lookupCountByKey).toEqual(
			new Map([
				["setup-model:020003e5", 1],
				["animation:0300061b", 1],
			]),
		);
		expect(
			assetService.createSnapshot().committed.map((entry) => ({
				key: entry.key,
				leaseCount: entry.leaseCount,
			})),
		).toEqual([
			{
				key: { id: "0300061b", kind: "animation" },
				leaseCount: 2,
			},
			{
				key: { id: "020003e5", kind: "setup-model" },
				leaseCount: 2,
			},
		]);
	});

	it("records explicit missing setup diagnostics and keeps the entity non-renderable", async () => {
		const assetService = createAssetService({
			failKeys: new Set(["setup-model:020003e5"]),
		});
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();

		expect(controller.createSnapshot().records[0]).toMatchObject({
			diagnostics: [
				{
					kind: "dynamic-resource-load-failed",
					message: "missing setup-model:020003e5",
					resource: "setup-model",
					resourceKey: {
						id: 0x020003e5,
						kind: "setup-model",
					},
				},
			],
			renderability: {
				reasons: ["resources-pending"],
				status: "non-renderable",
			},
			resources: {
				setupAnimation: {
					status: "failed",
				},
				status: "failed",
			},
		});
	});

	it("releases dynamic leases when static source retention removes records", async () => {
		const assetService = createAssetService();
		const controller = createController(assetService);

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		await flushPromises();
		expect(assetService.createSnapshot().committed[0]?.leaseCount).toBe(1);

		controller.retainStaticScopes([]);

		expect(
			assetService.createSnapshot().committed.map((entry) => entry.leaseCount),
		).toEqual([0, 0]);
	});
});

function createController(assetService: HostBackedAssetService): DynamicEntityController {
	const resourceManager = new DynamicEntityResourceManager({ assetService });
	return new DynamicEntityController({ resourceManager });
}

function createAssetService(
	options: { readonly failKeys?: ReadonlySet<string> } = {},
): HostBackedAssetService {
	return new HostBackedAssetService({
		host: new ResolvingRuntimeHost(options.failKeys),
	});
}

class ResolvingRuntimeHost implements RuntimeHost {
	readonly lookupCountByKey = new Map<string, number>();

	constructor(private readonly failKeys: ReadonlySet<string> = new Set()) {}

	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset> {
		const keyString = `${key.kind}:${key.id}`;
		this.lookupCountByKey.set(
			keyString,
			(this.lookupCountByKey.get(keyString) ?? 0) + 1,
		);
		if (this.failKeys.has(keyString)) {
			return Promise.reject(new Error(`missing ${keyString}`));
		}
		return Promise.resolve({
			key,
			payload: { ok: true },
			preparedAt: "2026-06-26T00:00:00.000Z",
			revision,
			sourceAssetId: `${key.kind}/${key.id}`,
		});
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

function createOutdoorSeedRecord(
	options: { readonly instanceId?: string } = {},
): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "outdoor-static-object-dynamic-seed",
		owner: createOwner("outdoor-buildings"),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: options.instanceId ?? "windmill-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellDynamicSeedRecord(): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "env-cell-static-object-dynamic-seed",
		owner: createOwner("landblock-env-cells"),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			envCellId: 0xda550100,
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: "env-cell-static-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "env-cells",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createOwner(
	domain: StaticWorkPeerRecordOwner["domain"],
): StaticWorkPeerRecordOwner {
	return {
		domain,
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		workId: `1:landblock:da55ffff:${domain}`,
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
