import { describe, expect, it } from "vitest";
import type {
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import { DynamicEntityController } from "./dynamic-entity-controller";

describe("dynamic entity controller", () => {
	it("creates stable non-renderable records from outdoor static-authored seeds", () => {
		const controller = new DynamicEntityController();

		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);

		expect(controller.createSnapshot()).toMatchObject({
			activeEntityCount: 1,
			nonRenderableEntityCount: 1,
			staticSeedCount: 1,
		});
		expect(controller.createSnapshot().records[0]).toMatchObject({
			animation: {
				defaultAnimationId: 0x0300061b,
				status: "pending-resource",
			},
			id: "static-authored-outdoor:outdoor-buildings:landblock:da55ffff:object:building:windmill-0:setup:020003e5",
			renderability: {
				reasons: ["resources-pending"],
				status: "non-renderable",
			},
			resources: {
				required: ["setup-model", "animation"],
				status: "pending",
			},
		});
	});

	it("re-ingests the same static source identity idempotently", () => {
		const controller = new DynamicEntityController();
		const seed = createOutdoorSeedRecord();

		controller.ingestStaticSeeds([seed]);
		controller.ingestStaticSeeds([seed]);

		expect(controller.createSnapshot().records).toHaveLength(1);
	});

	it("projects static-authored presentation policy from source facts and texture batch lookup", () => {
		const controller = new DynamicEntityController();

		controller.ingestStaticSeeds(
			[createOutdoorSeedRecord()],
			new Map([
				[
					"outdoor-buildings:landblock:da55ffff",
					"static-batch:outdoor-buildings",
				],
			]),
		);

		expect(controller.createSnapshot().records[0]?.presentation).toMatchObject({
			diagnostics: {
				kind: "static-authored",
				sourceScopeKey: "outdoor-buildings:landblock:da55ffff",
			},
			policy: {
				materialPlanningIdentity: {
					kind: "setup-backed-visual",
					visualObject: {
						kind: "dynamic-visual-object",
						resourceId:
							"dynamic-visual-resource:static-authored-outdoor:outdoor-buildings:landblock:da55ffff:object:building:windmill-0:setup:020003e5",
					},
				},
				ownershipPolicy: {
					kind: "dynamic-visual-resource",
					resourceId:
						"dynamic-visual-resource:static-authored-outdoor:outdoor-buildings:landblock:da55ffff:object:building:windmill-0:setup:020003e5",
				},
				retentionPolicy: {
					kind: "static-source-scope",
					sourceScopeKey: "outdoor-buildings:landblock:da55ffff",
				},
				textureBatchId: "static-batch:outdoor-buildings",
				textureDomain: "outdoor-buildings",
			},
			visualSource: {
				setupModelId: 0x020003e5,
				sourceAssetIds: ["setup-model/020003e5"],
			},
		});
	});

	it("replaces records for the same source identity when the static work owner changes", () => {
		const controller = new DynamicEntityController();

		controller.ingestStaticSeeds([
			createOutdoorSeedRecord({
				workId: "1:landblock:da55ffff:outdoor-buildings",
			}),
		]);
		controller.ingestStaticSeeds([
			createOutdoorSeedRecord({
				workId: "7:landblock:da55ffff:outdoor-buildings",
			}),
		]);

		expect(controller.createSnapshot().records).toHaveLength(1);
		expect(
			controller.createSnapshot().records[0]?.provenance.owner.workId,
		).toBe("7:landblock:da55ffff:outdoor-buildings");
	});

	it("removes records whose static source scope is no longer retained", () => {
		const controller = new DynamicEntityController();
		controller.ingestStaticSeeds([
			createOutdoorSeedRecord(),
			createOutdoorSeedRecord({
				instanceId: "windmill-1",
				landblockId: 0xdb55ffff,
				scopeKey: "landblock:db55ffff",
				workId: "1:landblock:db55ffff:outdoor-buildings",
			}),
		]);

		controller.retainStaticScopes([createRetainedScope()]);

		expect(controller.createSnapshot().records).toHaveLength(1);
		expect(controller.createSnapshot().records[0]?.sourceResidence).toEqual({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
	});

	it("ignores unclassified env-cell static seed records", () => {
		const controller = new DynamicEntityController();

		controller.ingestStaticSeeds([createEnvCellSeedRecord()]);

		expect(controller.createSnapshot().records).toEqual([]);
	});

	it("creates non-renderable records from classified env-cell dynamic seeds", () => {
		const controller = new DynamicEntityController();

		controller.ingestStaticSeeds([createEnvCellDynamicSeedRecord()]);

		expect(controller.createSnapshot()).toMatchObject({
			activeEntityCount: 1,
			nonRenderableEntityCount: 1,
			staticSeedCount: 1,
		});
		expect(controller.createSnapshot().records[0]).toMatchObject({
			animation: {
				defaultAnimationId: 0x0300061b,
				status: "pending-resource",
			},
			id: "static-authored-env-cell:landblock-env-cells:landblock:da55ffff:env-cell:da550100:object:building:seed-0:setup:020003e5",
			provenance: {
				kind: "static-authored-env-cell",
				sourceScopeKey: "landblock-env-cells:landblock:da55ffff",
			},
			renderability: {
				reasons: ["resources-pending"],
				status: "non-renderable",
			},
			sourceResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});
	});

	it("removes classified env-cell records with unretained env-cell scopes", () => {
		const controller = new DynamicEntityController();
		controller.ingestStaticSeeds([
			createOutdoorSeedRecord(),
			createEnvCellDynamicSeedRecord(),
		]);

		controller.retainStaticScopes([createRetainedScope()]);

		expect(controller.createSnapshot().records).toHaveLength(1);
		expect(controller.createSnapshot().records[0]?.provenance.kind).toBe(
			"static-authored-outdoor",
		);
	});

	it("creates runtime spawns with internal ids and server ids as metadata", () => {
		const controller = new DynamicEntityController();

		const firstId = controller.createRuntimeSpawn({
			baseLocalPlacement: createPlacement(),
			serverInstanceIdMetadata: { id: "server-object:5001" },
			setupModelId: 0x020003e5,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		});
		const secondId = controller.createRuntimeSpawn({
			baseLocalPlacement: createPlacement(),
			serverInstanceIdMetadata: { id: "server-object:5001" },
			setupModelId: 0x020003e5,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		});

		expect(firstId).toBe("runtime-spawn:1");
		expect(secondId).toBe("runtime-spawn:2");
		expect(controller.createSnapshot()).toMatchObject({
			activeEntityCount: 2,
			nonRenderableEntityCount: 2,
			runtimeSpawnCount: 2,
			staticAuthoredCount: 0,
			staticSeedCount: 0,
		});
		expect(controller.queryDynamicEntitySummary(firstId)).toMatchObject({
			id: firstId,
			presentation: {
				diagnostics: {
					kind: "runtime-spawn",
					serverInstanceIdMetadata: { id: "server-object:5001" },
				},
				policy: {
					materialPlanningIdentity: {
						kind: "pending",
						reason: "runtime-material-planning-identity-unsupported",
					},
					ownershipPolicy: {
						kind: "dynamic-visual-resource",
						resourceId: "dynamic-visual-resource:runtime-spawn:1",
					},
					retentionPolicy: {
						kind: "explicit-runtime-lifetime",
					},
					textureBatchId: "dynamic:runtime-spawn:1",
					textureDomain: "runtime-object-material",
				},
				visualSource: {
					setupModelId: 0x020003e5,
					sourceAssetIds: ["setup-model/020003e5"],
				},
			},
			provenance: {
				kind: "runtime-spawn",
				sourceKind: "browser-authored-server-shaped",
			},
			source: {
				kind: "runtime-spawn",
				runtimeEntityId: firstId,
				serverInstanceIdMetadata: { id: "server-object:5001" },
				setupModelId: 0x020003e5,
			},
		});
		expect(
			controller.queryDynamicEntitySummary(firstId)?.presentation.policy
				.textureBatchId,
		).not.toContain("server-object:5001");
	});

	it("keeps runtime spawns across static retention until explicit removal", () => {
		const controller = new DynamicEntityController();
		controller.ingestStaticSeeds([createOutdoorSeedRecord()]);
		const runtimeId = controller.createRuntimeSpawn({
			baseLocalPlacement: createPlacement(),
			setupModelId: 0x020003e5,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		});

		controller.retainStaticScopes([]);

		expect(controller.createSnapshot()).toMatchObject({
			activeEntityCount: 1,
			runtimeSpawnCount: 1,
			staticAuthoredCount: 0,
			staticSeedCount: 0,
		});
		expect(controller.queryDynamicEntitySummary(runtimeId)?.id).toBe(runtimeId);

		expect(controller.removeRuntimeSpawn(runtimeId)).toBe(true);
		expect(controller.removeRuntimeSpawn(runtimeId)).toBe(false);
		expect(controller.createSnapshot()).toMatchObject({
			activeEntityCount: 0,
			runtimeSpawnCount: 0,
			staticAuthoredCount: 0,
		});
	});

	it("updates runtime spawns without changing internal identity", () => {
		const controller = new DynamicEntityController();
		const runtimeId = controller.createRuntimeSpawn({
			baseLocalPlacement: createPlacement(),
			setupModelId: 0x020003e5,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		});

		expect(
			controller.updateRuntimeSpawn(runtimeId, {
				animationSelection: { animationId: 0x0300061b, kind: "explicit" },
				baseLocalPlacement: createPlacement(),
				serverInstanceIdMetadata: { id: "server-object:7007" },
				setupModelId: 0x02000400,
				sourceResidence: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(true);

		expect(controller.queryDynamicEntitySummary(runtimeId)).toMatchObject({
			animation: {
				defaultAnimationId: 0x0300061b,
			},
			id: runtimeId,
			source: {
				animationSelection: { animationId: 0x0300061b, kind: "explicit" },
				kind: "runtime-spawn",
				runtimeEntityId: runtimeId,
				serverInstanceIdMetadata: { id: "server-object:7007" },
				setupModelId: 0x02000400,
			},
			sourceResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			presentation: {
				policy: {
					textureBatchId: "dynamic:runtime-spawn:1",
					textureDomain: "runtime-object-material",
				},
			},
		});
		expect(
			controller.updateRuntimeSpawn("static-authored-outdoor:nope", {
				baseLocalPlacement: createPlacement(),
				setupModelId: 0x020003e5,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(false);
	});
});

function createOutdoorSeedRecord(
	options: {
		readonly instanceId?: string;
		readonly landblockId?: number;
		readonly scopeKey?: string;
		readonly workId?: string;
	} = {},
): StaticAuthoredDynamicSeedRecord {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const scopeKey = options.scopeKey ?? "landblock:da55ffff";
	return {
		kind: "outdoor-static-object-dynamic-seed",
		owner: createOwner({
			landblockId,
			scopeKey,
			workId: options.workId ?? "1:landblock:da55ffff:outdoor-buildings",
		}),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId,
			localPlacement: createPlacement(),
			object: {
				instanceId: options.instanceId ?? "windmill-0",
				kind: "static-object-instance",
				landblockId,
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
				landblockId,
				source: "outdoor",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellSeedRecord(): StaticAuthoredDynamicSeedRecord {
	return {
		envCellId: 0xda550100,
		kind: "env-cell-static-object-seed",
		landblockId: 0xda55ffff,
		owner: createOwner({
			domain: "landblock-env-cells",
			workId: "1:landblock:da55ffff:landblock-env-cells",
		}),
		seed: {
			debug: { sourceAssetId: "setup-model/020003e5" },
			identity: {
				instanceId: "seed-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			localPlacement: createPlacement(),
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceIndex: 0,
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellDynamicSeedRecord(): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "env-cell-static-object-dynamic-seed",
		owner: createOwner({
			domain: "landblock-env-cells",
			workId: "1:landblock:da55ffff:landblock-env-cells",
		}),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			envCellId: 0xda550100,
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: "seed-0",
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

function createRetainedScope(): StaticScopeOwnerKey {
	return {
		domain: "outdoor-buildings",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
	};
}

function createOwner(options: {
	readonly domain?: StaticWorkPeerRecordOwner["domain"];
	readonly landblockId?: number;
	readonly scopeKey?: string;
	readonly workId: string;
}): StaticWorkPeerRecordOwner {
	const landblockId = options.landblockId ?? 0xda55ffff;
	return {
		domain: options.domain ?? "outdoor-buildings",
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: options.scopeKey ?? "landblock:da55ffff",
		workId: options.workId,
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 1, y: 2, z: 3 },
	};
}
