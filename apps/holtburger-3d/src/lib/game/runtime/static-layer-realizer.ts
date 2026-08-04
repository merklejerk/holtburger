import type { AtlasRequirementHandle } from "../textures/atlas/resident-texture-atlas";
import type { AssetTextureFact } from "../textures/types";
import type { SceneInterestRevision } from "./scene-availability";
import type { PlacedStaticLight } from "../commit/interior-static-lighting";
import type { StaticLayerKind } from "./scene-interest";

/** Exact currentness query retained at the scene-interest boundary. */
export interface StaticLayerCurrentness<TOwner extends string> {
	isCurrent(
		owner: TOwner,
		layer: StaticLayerKind,
		revision: SceneInterestRevision,
	): boolean;
}

/** Runtime-local reporting hook for current visual-realization failures. */
export interface StaticLayerFailureReporter<TOwner extends string> {
	reportAtlasFailure(options: {
		readonly cause: unknown;
		readonly layer: StaticLayerKind;
		readonly owner: TOwner;
		readonly revision: SceneInterestRevision;
	}): void;
}

/** Narrow revision-scoped atlas contract used only for static realization sequencing. */
export interface StaticLayerAtlas<TOwner extends string> {
	activateOwnerRevision(handle: AtlasRequirementHandle<TOwner>): Promise<void>;
	evictOwnerRequirements(
		owner: TOwner,
		revision: SceneInterestRevision,
	): Promise<void>;
	prepareOwnerRequirements(
		owner: TOwner,
		revision: SceneInterestRevision,
		facts: readonly AssetTextureFact[],
	): AtlasRequirementHandle<TOwner>;
	withdrawOwnerRevision(handle: AtlasRequirementHandle<TOwner>): Promise<void>;
}

/** Asynchronous geometry preparation for one classified static-layer source. */
export interface StaticLayerGeometryPreparer<
	TSource,
	TGeometry,
	TOwner extends string,
> {
	prepare(options: {
		readonly layer: StaticLayerKind;
		readonly partition?: string;
		readonly owner: TOwner;
		readonly revision: SceneInterestRevision;
		readonly source: TSource;
		/** Interior jobs supply authored lights to bake into merged geometry; outdoor pass none. */
		readonly staticLights?: readonly PlacedStaticLight[];
		readonly textureRequirements: readonly AssetTextureFact[];
	}): Promise<TGeometry>;
	/** Terminate the private geometry worker after all pending outputs are made stale. */
	destroy?(): void;
}

/** Failure-atomic static scene replacement owned by the existing static publication path. */
export interface StaticLayerPublisher<TGeometry, TOwner extends string> {
	removeExact(owner: TOwner, revision: SceneInterestRevision): Promise<void>;
	replace(options: {
		readonly geometry: TGeometry;
		readonly layer: StaticLayerKind;
		readonly owner: TOwner;
		readonly revision: SceneInterestRevision;
	}): Promise<void>;
	evict(owner: TOwner, revision: SceneInterestRevision): Promise<void>;
}

/** Input assembled from one already resolved and classified outdoor-static source. */
export interface StaticLayerRealizationInput<TSource, TOwner extends string> {
	readonly layer: StaticLayerKind;
	readonly owner: TOwner;
	readonly revision: SceneInterestRevision;
	readonly source: TSource;
	readonly textureRequirements: readonly AssetTextureFact[];
	/** Optional staged companion publication prepared before any active static state is replaced. */
	readonly prepareCompanion?: () => Promise<StaticLayerCompanionPublication>;
}

/** Synchronous companion cutover paired with one already prepared static realization. */
export interface StaticLayerCompanionPublication {
	commit(): void;
	release(): void;
}

/** Typed result consumed by the later runtime handoff; dynamic entities deliberately stay absent. */
export type StaticLayerRealizationResult<TGeometry> =
	| { readonly kind: "published"; readonly geometry: TGeometry }
	| { readonly kind: "stale" };

interface PendingRealization<TOwner extends string, TGeometry> {
	readonly atlasHandle: AtlasRequirementHandle<TOwner>;
	readonly completion: Promise<StaticLayerRealizationResult<TGeometry>>;
}

/**
 * Sequences one static layer's geometry, atlas readiness, currentness, and publication.
 *
 * It intentionally owns no renderer resources, scene nodes, source cache, atlas placement, or
 * scene-interest policy. Those remain behind the injected authoritative ports.
 */
export class StaticLayerRealizer<TSource, TGeometry, TOwner extends string> {
	readonly #atlas: StaticLayerAtlas<TOwner>;
	readonly #currentness: StaticLayerCurrentness<TOwner>;
	readonly #failureReporter: StaticLayerFailureReporter<TOwner>;
	readonly #geometry: StaticLayerGeometryPreparer<TSource, TGeometry, TOwner>;
	readonly #publisher: StaticLayerPublisher<TGeometry, TOwner>;
	readonly #pending = new Map<
		TOwner,
		Map<SceneInterestRevision, PendingRealization<TOwner, TGeometry>>
	>();
	#destroyed = false;

	constructor(options: {
		readonly atlas: StaticLayerAtlas<TOwner>;
		readonly currentness: StaticLayerCurrentness<TOwner>;
		readonly failureReporter: StaticLayerFailureReporter<TOwner>;
		readonly geometry: StaticLayerGeometryPreparer<TSource, TGeometry, TOwner>;
		readonly publisher: StaticLayerPublisher<TGeometry, TOwner>;
	}) {
		this.#atlas = options.atlas;
		this.#currentness = options.currentness;
		this.#failureReporter = options.failureReporter;
		this.#geometry = options.geometry;
		this.#publisher = options.publisher;
	}

	/** Start or return the one exact pending realization for an owner and scene-interest revision. */
	realize(
		input: StaticLayerRealizationInput<TSource, TOwner>,
	): Promise<StaticLayerRealizationResult<TGeometry>> {
		if (this.#destroyed) return Promise.resolve({ kind: "stale" });
		const existing = this.#pending.get(input.owner)?.get(input.revision);
		if (existing) return existing.completion;
		const atlasHandle = this.#atlas.prepareOwnerRequirements(
			input.owner,
			input.revision,
			input.textureRequirements,
		);
		const completion = this.#realize(input, atlasHandle).finally(() => {
			const pendingByRevision = this.#pending.get(input.owner);
			pendingByRevision?.delete(input.revision);
			if (pendingByRevision?.size === 0) this.#pending.delete(input.owner);
		});
		const pendingByRevision =
			this.#pending.get(input.owner) ??
			new Map<SceneInterestRevision, PendingRealization<TOwner, TGeometry>>();
		this.#pending.set(input.owner, pendingByRevision);
		pendingByRevision.set(input.revision, { atlasHandle, completion });
		return completion;
	}

	/** Evict static state and atlas claims using the coordinator's exact evicted revision. */
	async evict(owner: TOwner, revision: SceneInterestRevision): Promise<void> {
		await Promise.all([
			this.#publisher.evict(owner, revision),
			this.#atlas.evictOwnerRequirements(owner, revision),
		]);
	}

	/** Withdraw every pending exact requirement without destroying shared atlas or publisher state. */
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const settlements: Promise<unknown>[] = [];
		for (const pendingByRevision of this.#pending.values()) {
			for (const pending of pendingByRevision.values()) {
				settlements.push(
					this.#atlas.withdrawOwnerRevision(pending.atlasHandle),
					pending.completion,
				);
			}
		}
		this.#pending.clear();
		this.#geometry.destroy?.();
		await Promise.allSettled(settlements);
	}

	async #realize(
		input: StaticLayerRealizationInput<TSource, TOwner>,
		atlasHandle: AtlasRequirementHandle<TOwner>,
	): Promise<StaticLayerRealizationResult<TGeometry>> {
		const geometry = this.#geometry.prepare({
			layer: input.layer,
			owner: input.owner,
			revision: input.revision,
			source: input.source,
			textureRequirements: input.textureRequirements,
		});
		const companion = input.prepareCompanion?.();
		let preparedCompanion: StaticLayerCompanionPublication | null = null;
		let published = false;
		try {
			const [preparedGeometry, atlasCompletion, companionPublication] =
				await Promise.all([
					geometry,
					atlasHandle.completion,
					companion ?? Promise.resolve(null),
				]);
			preparedCompanion = companionPublication;
			if (atlasCompletion !== "ready") {
				if (this.#isCurrent(input.owner, input.layer, input.revision)) {
					if (atlasCompletion !== "withdrawn") {
						this.#failureReporter.reportAtlasFailure({
							cause: atlasCompletion.cause,
							layer: input.layer,
							owner: input.owner,
							revision: input.revision,
						});
					}
				}
				preparedCompanion?.release();
				await this.#atlas.withdrawOwnerRevision(atlasHandle);
				return { kind: "stale" };
			}
			if (!this.#isCurrent(input.owner, input.layer, input.revision)) {
				preparedCompanion?.release();
				await this.#atlas.withdrawOwnerRevision(atlasHandle);
				return { kind: "stale" };
			}
			await this.#publisher.replace({
				geometry: preparedGeometry,
				layer: input.layer,
				owner: input.owner,
				revision: input.revision,
			});
			published = true;
			if (!this.#isCurrent(input.owner, input.layer, input.revision)) {
				await Promise.all([
					this.#publisher.removeExact(input.owner, input.revision),
					this.#atlas.withdrawOwnerRevision(atlasHandle),
				]);
				preparedCompanion?.release();
				return { kind: "stale" };
			}
			await this.#atlas.activateOwnerRevision(atlasHandle);
			preparedCompanion?.commit();
			return { geometry: preparedGeometry, kind: "published" };
		} catch (cause) {
			preparedCompanion?.release();
			await Promise.all([
				this.#atlas.withdrawOwnerRevision(atlasHandle),
				published
					? this.#publisher.removeExact(input.owner, input.revision)
					: Promise.resolve(),
			]);
			const message = cause instanceof Error ? cause.message : String(cause);
			throw new Error(
				`Static layer ${input.owner} revision ${input.revision} failed to realize: ${message}`,
				{ cause },
			);
		}
	}

	#isCurrent(
		owner: TOwner,
		layer: StaticLayerKind,
		revision: SceneInterestRevision,
	): boolean {
		return (
			!this.#destroyed && this.#currentness.isCurrent(owner, layer, revision)
		);
	}
}
