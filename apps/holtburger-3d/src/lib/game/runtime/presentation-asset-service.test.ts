import { describe, expect, it, vi } from "vitest";

import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import type { SetupVisualAppearance } from "../../assets/setup-visual-source";
import { resolveObjectBehavior } from "../resolution/object-resident-classifier";
import { acquireObjectPreviewAssets } from "../preview/object-preview-assets";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	PresentationAssetService,
	SetupVisualAssetRepository,
} from "./presentation-asset-service";

const APPEARANCE: SetupVisualAppearance = {
	paletteDid: null,
	partChanges: [],
	subPalettes: [],
	textureChanges: [],
};

describe("SetupVisualAssetRepository", () => {
	it("coalesces an exact setup appearance and releases it after its last handle", async () => {
		let resolveVisual:
			((visual: DecodedStaticPresentation) => void) | undefined;
		const completion = new Promise<DecodedStaticPresentation>((resolve) => {
			resolveVisual = resolve;
		});
		const destroy = vi.fn();
		const load = vi.fn(() => completion);
		const repository = new SetupVisualAssetRepository({ destroy, load });

		const first = repository.acquire(0x02000001, APPEARANCE);
		const second = repository.acquire(0x02000001, APPEARANCE);
		await Promise.resolve();
		expect(load).toHaveBeenCalledTimes(1);
		expect(repository.getDiagnostics()).toMatchObject({
			assetCount: 1,
			preparingCount: 1,
			referenceCount: 2,
		});
		resolveVisual?.(visual());
		const [firstHandle, secondHandle] = await Promise.all([first, second]);
		expect(firstHandle.asset).toBe(secondHandle.asset);
		expect(repository.getDiagnostics()).toMatchObject({
			readyCount: 1,
			referenceCount: 2,
		});

		firstHandle.release();
		expect(repository.getDiagnostics().referenceCount).toBe(1);
		secondHandle.release();
		expect(repository.getDiagnostics()).toMatchObject({
			assetCount: 0,
			referenceCount: 0,
		});
		repository.destroy();
		expect(destroy).toHaveBeenCalledOnce();
	});
});

describe("PresentationAssetService", () => {
	it("rolls back every preview lease when composite preparation fails", async () => {
		const service = new PresentationAssetService({
			animationSource: emptyAnimationSource(vi.fn()),
			particleEmitterSource: emptyParticleEmitterSource(vi.fn()),
			physicsScriptSource: emptyPhysicsScriptSource(vi.fn()),
			setupVisualSource: { destroy: vi.fn(), load: async () => visual() },
			texturePreparer: emptyTexturePreparer(vi.fn(async () => undefined)),
		});

		await expect(
			acquireObjectPreviewAssets(service, {
				appearance: APPEARANCE,
				guid: 1,
				pose: { kind: "setup-pose" },
				scale: 1,
				setupDid: 0x02000001,
				translucency: 0,
			}),
		).rejects.toThrow("authors neither placement 0 nor fallback 0");
		expect(service.setupVisuals.getDiagnostics().referenceCount).toBe(0);
		expect(service.objectTemplates.getDiagnostics().referenceCount).toBe(0);
		await service.destroy();
	});

	it("refuses partial source teardown while a consumer still owns a lease", async () => {
		const destroyed = {
			animation: vi.fn(),
			emitter: vi.fn(),
			physicsScript: vi.fn(),
			setup: vi.fn(),
			texture: vi.fn(async () => undefined),
		};
		const service = new PresentationAssetService({
			animationSource: emptyAnimationSource(destroyed.animation),
			particleEmitterSource: emptyParticleEmitterSource(destroyed.emitter),
			physicsScriptSource: emptyPhysicsScriptSource(destroyed.physicsScript),
			setupVisualSource: {
				destroy: destroyed.setup,
				load: async () => visual(),
			},
			texturePreparer: emptyTexturePreparer(destroyed.texture),
		});
		const handle = await service.setupVisuals.acquire(0x02000001, APPEARANCE);

		await expect(service.destroy()).rejects.toThrow(
			"Cannot destroy presentation assets while referenced: setup visuals (1).",
		);
		expect(
			Object.values(destroyed).every(
				(destroy) => destroy.mock.calls.length === 0,
			),
		).toBe(true);

		handle.release();
		await service.destroy();
		for (const destroy of Object.values(destroyed))
			expect(destroy).toHaveBeenCalledOnce();
	});
});

function visual(): DecodedStaticPresentation {
	return {
		behavior: resolveObjectBehavior({
			animationId: null,
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		}),
		localBounds: null,
		partParents: [],
		presentation: {
			appearanceKey: "fixture",
			holdingLocations: new Map(),
			id: "presentation:fixture",
			lights: [],
			parts: [],
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x02000001",
		},
		setupId: "0x02000001",
	};
}

function emptyAnimationSource(destroy: () => void): AnimationAssetSource {
	return {
		destroy,
		loadAnimation: async () => {
			throw new Error("Animation fixture does not load assets.");
		},
		loadMotionTableClosure: async () => [],
	};
}

function emptyPhysicsScriptSource(destroy: () => void): PhysicsScriptSource {
	return {
		destroy,
		loadPhysicsScript: async () => {
			throw new Error("Physics-script fixture does not load assets.");
		},
	};
}

function emptyParticleEmitterSource(
	destroy: () => void,
): ParticleEmitterSource {
	return {
		destroy,
		loadParticleEmitter: async () => {
			throw new Error("Particle-emitter fixture does not load assets.");
		},
	};
}

function emptyTexturePreparer(destroy: () => Promise<void>): TexturePreparer {
	return {
		destroy,
		prepare: async () => {
			throw new Error("Texture fixture does not prepare assets.");
		},
	};
}
