import { describe, expect, it } from "vitest";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import type { GeometrySource } from "../geometry/types";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../resolution/presentation";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateManager,
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
	type ObjectVisualTemplatePreparer,
} from "./object-visual-template-manager";

describe("ObjectVisualTemplateManager", () => {
	it("shares one in-flight preparation across owners and retains complete material ranges", async () => {
		const geometry = new FixtureGeometry();
		const preparer = new CountingPreparer();
		const manager = createManager(geometry, preparer);
		const visual = source("shared", "appearance:base");

		const first = manager.stageOwner([visual]);
		const second = manager.stageOwner([visual]);
		const [firstOutcome] = await Promise.all([
			first.completion,
			second.completion,
		]);

		expect(preparer.count).toBe(1);
		first.commit("first");
		second.commit("second");
		const template = firstOutcome.get(objectVisualTemplateKey(visual));
		expect(template?.parts[0]?.drawUnits).toMatchObject([
			{ indexCount: 3, indexStart: 0, partIndex: 0 },
			{ indexCount: 3, indexStart: 3, partIndex: 0 },
			{ indexCount: 3, indexStart: 6, partIndex: 0 },
		]);
		expect(geometry.resources.size).toBe(1);

		manager.dropOwner("first");
		expect(geometry.resources.size).toBe(1);
		manager.dropOwner("second");
		expect(geometry.resources.size).toBe(0);
	});

	it("does not alias distinct canonical appearances", async () => {
		const preparer = new CountingPreparer();
		const manager = createManager(new FixtureGeometry(), preparer);
		const base = source("base", "appearance:base");
		const changed = source("changed", "appearance:changed");

		const staged = manager.stageOwner([base, changed]);
		const outcome = await staged.completion;
		staged.commit("layer");

		expect(preparer.count).toBe(2);
		expect(outcome.size).toBe(2);
	});

	it("cannot publish an evicted in-flight template", async () => {
		const inline = new InlineObjectVisualTemplatePreparer();
		const visual = source("stale", "appearance:stale");
		const prepared = await inline.prepare(visual);
		const preparer = new DeferredPreparer();
		const geometry = new FixtureGeometry();
		const manager = createManager(geometry, preparer);
		const requirement = manager.stageOwner([visual]);

		requirement.release();
		preparer.resolve(prepared);

		await expect(requirement.completion).resolves.toEqual(
			new Map([[prepared.key, prepared]]),
		);
		expect(manager.getState(objectVisualTemplateKey(visual))).toBeNull();
		expect(geometry.resources.size).toBe(0);
	});

	it("releases a failed staged template without disturbing committed ownership", async () => {
		const visual = source("failed", "appearance:failed");
		const manager = createManager(new FixtureGeometry(), {
			async prepare() {
				throw new Error("template failed");
			},
			async destroy() {},
		});
		const requirement = manager.stageOwner([visual]);

		await expect(requirement.completion).rejects.toThrow("template failed");
		expect(manager.getState(objectVisualTemplateKey(visual))).toBe("failed");

		requirement.release();
		expect(manager.getState(objectVisualTemplateKey(visual))).toBeNull();
	});
});

function createManager(
	geometry: FixtureGeometry,
	preparer: ObjectVisualTemplatePreparer,
) {
	return new ObjectVisualTemplateManager(geometry, preparer);
}

function source(id: string, appearanceKey: string): AuthoredDynamicSource {
	return {
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: id },
		localBounds: AABB3.zero(),
		placement: {
			envCellId: null,
			landblockId: "0x0001ffff",
			localTransform: Mat4.identity(),
		},
		presentation: {
			appearanceKey,
			holdingLocations: new Map(),
			id: `presentation:${appearanceKey}`,
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: multiMaterialGeometry(),
					materials: [material("first"), material("second")],
					partIndex: 0,
				},
			],
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: AABB3.zero(),
			sortingBounds: null,
			sourceAssetId: "setup-model/02000001",
		},
		scale: new Vec3(1, 1, 1),
		setupId: "0x02000001",
	};
}

function multiMaterialGeometry(): ResolvedGeometry {
	return {
		bounds: AABB3.zero(),
		id: "geometry:multi-material",
		indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1]),
		materialSideKinds: new Uint8Array([0, 0, 0]),
		materialSideTypes: new Uint8Array([0, 0, 0]),
		materialSlotIndices: new Uint16Array([0, 1, 0]),
		materialStippling: new Uint8Array([0, 0, 0]),
		materialWrapModes: new Uint8Array([0, 0, 0]),
		normals: new Float32Array(12),
		positions: new Float32Array(12),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		textureCoordinates: new Float32Array(8),
	};
}

function material(id: string): ResolvedMaterial {
	return {
		color: [1, 1, 1, 1],
		diffuseScale: 1,
		id: `material:${id}`,
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags: 0,
		translucency: 0,
	};
}

class CountingPreparer implements ObjectVisualTemplatePreparer {
	readonly #inline = new InlineObjectVisualTemplatePreparer();
	count = 0;

	prepare(source: AuthoredDynamicSource): Promise<ObjectVisualTemplate> {
		this.count += 1;
		return this.#inline.prepare(source);
	}

	async destroy(): Promise<void> {}
}

class DeferredPreparer implements ObjectVisualTemplatePreparer {
	#resolve: ((template: ObjectVisualTemplate) => void) | null = null;

	prepare(): Promise<ObjectVisualTemplate> {
		return new Promise((resolve) => {
			this.#resolve = resolve;
		});
	}

	resolve(template: ObjectVisualTemplate): void {
		const resolve = this.#resolve;
		if (!resolve) throw new Error("No visual template is pending.");
		this.#resolve = null;
		resolve(template);
	}

	async destroy(): Promise<void> {}
}

class FixtureGeometry {
	readonly leases = new Map<string, Set<string>>();
	readonly sources = new Map<string, GeometrySource>();
	readonly resources = new Set<string>();

	reserveKeys(owner: string, keys: readonly string[]): void {
		for (const key of keys) {
			const owners = this.leases.get(key) ?? new Set();
			owners.add(owner);
			this.leases.set(key, owners);
		}
	}

	replaceOwner(owner: string, sources: readonly GeometrySource[]): void {
		this.dropOwner(owner);
		this.reserveKeys(
			owner,
			sources.map((source) => source.key),
		);
		for (const source of sources) this.upsertGeometry(source);
	}

	upsertGeometry(source: GeometrySource): void {
		this.sources.set(source.key, source);
		this.resources.add(source.key);
	}

	dropOwner(owner: string): void {
		for (const [key, owners] of [...this.leases]) {
			owners.delete(owner);
			if (owners.size > 0) continue;
			this.leases.delete(key);
			this.resources.delete(key);
		}
	}
}
