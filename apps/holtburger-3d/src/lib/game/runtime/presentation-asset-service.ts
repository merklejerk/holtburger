import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import type {
	SetupVisualAppearance,
	SetupVisualSource,
} from "../../assets/setup-visual-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateAssetRepository,
} from "../systems/object-visual-template-repository";
import type {
	PreparedAssetDiagnostics,
	PreparedAssetHandle,
} from "../behavior/prepared-asset-repository";
import {
	WorkerTexturePreparer,
	type TexturePreparer,
} from "../textures/texture-preparer";

/** Exact immutable setup lookup identity; placement and playback never enter this key. */
export function setupVisualKey(
	setupDid: number,
	appearance: SetupVisualAppearance,
): string {
	return JSON.stringify({ appearance, setupDid });
}

interface SetupVisualEntry {
	readonly key: string;
	referenceCount: number;
	readonly completion: Promise<DecodedStaticPresentation>;
	readonly state: "preparing" | "ready" | "failed";
}

/** Reference-counted setup/appearance transfer independent of scene or device residency. */
export class SetupVisualAssetRepository {
	readonly #source: SetupVisualSource | null;
	readonly #entries = new Map<string, SetupVisualEntry>();
	#destroyed = false;

	constructor(source: SetupVisualSource | null) {
		this.#source = source;
	}

	/** Whether this composition can admit entities requiring setup visual preparation. */
	get available(): boolean {
		return this.#source !== null;
	}

	async acquire(
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<PreparedAssetHandle<DecodedStaticPresentation>> {
		if (this.#destroyed)
			throw new Error(
				"Cannot acquire from a destroyed SetupVisual repository.",
			);
		if (this.#source === null)
			throw new Error(
				"This presentation has no SetupVisual source capability.",
			);
		const key = setupVisualKey(setupDid, appearance);
		const entry =
			this.#entries.get(key) ?? this.#start(key, setupDid, appearance);
		entry.referenceCount += 1;
		let asset: DecodedStaticPresentation;
		try {
			asset = await entry.completion;
		} catch (cause) {
			this.#releaseEntry(entry);
			throw cause;
		}
		let released = false;
		return {
			asset,
			release: () => {
				if (released)
					throw new Error(`SetupVisual ${key} handle released twice.`);
				released = true;
				this.#releaseEntry(entry);
			},
		};
	}

	getDiagnostics(): PreparedAssetDiagnostics {
		const entries = [...this.#entries.values()];
		return {
			assetCount: entries.length,
			failedCount: entries.filter((entry) => entry.state === "failed").length,
			preparingCount: entries.filter((entry) => entry.state === "preparing")
				.length,
			readyCount: entries.filter((entry) => entry.state === "ready").length,
			referenceCount: entries.reduce(
				(total, entry) => total + entry.referenceCount,
				0,
			),
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		const referenced = [...this.#entries.values()].find(
			(entry) => entry.referenceCount !== 0,
		);
		if (referenced)
			throw new Error(
				`Cannot destroy SetupVisual repository while ${referenced.key} is referenced.`,
			);
		this.#destroyed = true;
		this.#entries.clear();
		this.#source?.destroy?.();
	}

	#start(
		key: string,
		setupDid: number,
		appearance: SetupVisualAppearance,
	): SetupVisualEntry {
		const source = this.#source;
		if (source === null)
			throw new Error(
				"This presentation has no SetupVisual source capability.",
			);
		let state: SetupVisualEntry["state"] = "preparing";
		const completion = Promise.resolve()
			.then(() => source.load(setupDid, appearance))
			.then((asset) => {
				state = "ready";
				return asset;
			})
			.catch((cause: unknown) => {
				state = "failed";
				throw cause;
			});
		const entry: SetupVisualEntry = {
			completion,
			key,
			referenceCount: 0,
			get state() {
				return state;
			},
		};
		this.#entries.set(key, entry);
		void entry.completion.catch(() => {
			if (this.#entries.get(key) === entry && entry.referenceCount === 0)
				this.#entries.delete(key);
		});
		return entry;
	}

	#releaseEntry(entry: SetupVisualEntry): void {
		if (entry.referenceCount <= 0)
			throw new Error(`SetupVisual ${entry.key} has no reference to release.`);
		entry.referenceCount -= 1;
		if (entry.referenceCount === 0 && this.#entries.get(entry.key) === entry)
			this.#entries.delete(entry.key);
	}
}

/** Immutable source/repository lifetime shared by world and isolated preview presentations. */
export class PresentationAssetService {
	readonly setupVisuals: SetupVisualAssetRepository;
	readonly animations: AnimationAssetRepository;
	readonly physicsScripts: PhysicsScriptRepository;
	readonly particleEmitters: ParticleEmitterRepository;
	readonly objectTemplates: ObjectVisualTemplateAssetRepository;
	readonly texturePreparer: TexturePreparer;
	#destroyed = false;

	constructor(dependencies: {
		readonly setupVisualSource: SetupVisualSource | null;
		readonly animationSource: AnimationAssetSource;
		readonly physicsScriptSource: PhysicsScriptSource;
		readonly particleEmitterSource: ParticleEmitterSource;
		readonly texturePreparer: TexturePreparer;
	}) {
		this.setupVisuals = new SetupVisualAssetRepository(
			dependencies.setupVisualSource,
		);
		this.animations = new AnimationAssetRepository(
			dependencies.animationSource,
		);
		this.physicsScripts = new PhysicsScriptRepository(
			dependencies.physicsScriptSource,
		);
		this.particleEmitters = new ParticleEmitterRepository(
			dependencies.particleEmitterSource,
		);
		this.objectTemplates = new ObjectVisualTemplateAssetRepository(
			new InlineObjectVisualTemplatePreparer(),
		);
		this.texturePreparer = dependencies.texturePreparer;
	}

	/** Construct the one CPU preparation service owned by a browser presentation composition. */
	static async build(dependencies: {
		readonly setupVisualSource: SetupVisualSource;
		readonly animationSource: AnimationAssetSource;
		readonly physicsScriptSource: PhysicsScriptSource;
		readonly particleEmitterSource: ParticleEmitterSource;
		readonly texturePixelSource: TexturePixelSource;
	}): Promise<PresentationAssetService> {
		return new PresentationAssetService({
			...dependencies,
			texturePreparer: await WorkerTexturePreparer.build(
				dependencies.texturePixelSource,
			),
		});
	}

	/** Destroy sources once, after every presentation has released its handles. */
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		const referenced = [
			["setup visuals", this.setupVisuals.getDiagnostics().referenceCount],
			["animations", this.animations.getDiagnostics().referenceCount],
			["physics scripts", this.physicsScripts.getDiagnostics().referenceCount],
			[
				"particle emitters",
				this.particleEmitters.getDiagnostics().referenceCount,
			],
			[
				"object visual templates",
				this.objectTemplates.getDiagnostics().referenceCount,
			],
		].filter(([, count]) => count !== 0);
		if (referenced.length > 0)
			throw new Error(
				`Cannot destroy presentation assets while referenced: ${referenced
					.map(([label, count]) => `${label} (${count})`)
					.join(", ")}.`,
			);
		this.#destroyed = true;
		const failures: unknown[] = [];
		for (const destroy of [
			() => this.objectTemplates.destroy(),
			() => this.particleEmitters.destroy(),
			() => this.physicsScripts.destroy(),
			() => this.animations.destroy(),
			() => this.setupVisuals.destroy(),
			() => this.texturePreparer.destroy(),
		]) {
			try {
				await destroy();
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length > 0)
			throw new AggregateError(
				failures,
				"One or more presentation asset sources failed to close.",
			);
	}
}
