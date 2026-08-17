import type { DynamicPresentationSource } from "./dynamic-presentation-source";
import {
	createObjectGeometryKey,
	type GeometrySource,
	type ObjectGeometryKey,
} from "../geometry/types";
import { resolveObjectMaterialRanges } from "../commit/object-material-ranges";
import type { ResolvedObjectPart } from "../resolution/presentation";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { AABB3, Vec3 } from "../math/types";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import type { AtlasRequirementCompletion } from "../textures/atlas/resident-texture-atlas";
import type { PartVisualTemplateKey, RigidPartDrawUnit } from "./components";

declare const objectVisualTemplateKeyBrand: unique symbol;

/** Canonical immutable identity of one host-resolved setup appearance. */
export type ObjectVisualTemplateKey = `object-visual-template:${string}` & {
	readonly [objectVisualTemplateKeyBrand]: true;
};

/** Prepared immutable visual definition shared by every matching authored resident. */
export interface ObjectVisualTemplate {
	readonly key: ObjectVisualTemplateKey;
	readonly appearanceKey: string;
	readonly baseBounds: AABB3 | null;
	readonly geometry: readonly GeometrySource[];
	readonly parts: readonly PartVisualTemplate[];
	readonly textureRequirements: readonly AssetTextureFact[];
}

/** One prepared rigid part and all of its authored material/polygon partitions. */
export interface PartVisualTemplate {
	readonly key: PartVisualTemplateKey;
	readonly partIndex: number;
	readonly geometry: ObjectGeometryKey;
	/** Setup-authored geometry scale, composed independently from every rigid pose. */
	readonly defaultScale: Vec3;
	/** Untransformed geometry-local bounds used by animation sweeps. */
	readonly localBounds: AABB3 | null;
	readonly drawUnits: readonly RigidPartDrawUnit[];
}

/** CPU-heavy visual preparation boundary injected into the sharing/lifetime manager. */
export interface ObjectVisualTemplatePreparer {
	prepare(source: DynamicPresentationSource): Promise<ObjectVisualTemplate>;
	destroy(): Promise<void>;
}

/** Main-thread preparer used until visual-template work moves behind a worker boundary. */
export class InlineObjectVisualTemplatePreparer implements ObjectVisualTemplatePreparer {
	async prepare(source: DynamicPresentationSource): Promise<ObjectVisualTemplate> {
		return prepareObjectVisualTemplate(source);
	}

	async destroy(): Promise<void> {}
}

/** Prepared consumer requirements that do not disturb the active owner until explicit commit. */
export interface StagedObjectVisualTemplateOwner<TOwnerId extends string> {
	readonly completion: Promise<
		ReadonlyMap<ObjectVisualTemplateKey, ObjectVisualTemplate>
	>;
	commit(ownerId: TOwnerId): void;
	release(): void;
}

/** Device-resource owner derived solely from one immutable visual-template identity. */
export type ObjectVisualTemplateResourceOwnerId =
	`object-visual-template-resource:${ObjectVisualTemplateKey}`;

/** Opaque atlas claim retained by one prepared template entry. */
export interface ObjectVisualTemplateAtlasClaim {
	readonly completion: Promise<AtlasRequirementCompletion>;
}

/** Atlas operations required to make every prepared template texture drawable. */
export interface ObjectVisualTemplateAtlas<
	TClaim extends ObjectVisualTemplateAtlasClaim,
> {
	prepareOwnerRequirements(
		ownerId: ObjectVisualTemplateResourceOwnerId,
		revision: number,
		facts: readonly AssetTextureFact[],
	): TClaim;
	activateOwnerRevision(claim: TClaim): Promise<void>;
	withdrawOwnerRevision(claim: TClaim): Promise<void>;
}

/** Resource-free repository diagnostics consumed by runtime observability. */
export interface ObjectVisualTemplateRepositoryDiagnostics {
	readonly failedTemplateCount: number;
	readonly preparingTemplateCount: number;
	readonly readyTemplateCount: number;
	readonly templateCount: number;
}

/** Dynamic-system boundary independent of the repository's concrete atlas claim type. */
export interface ObjectVisualTemplateRepositoryPort<TOwnerId extends string> {
	stageOwner(
		sources: readonly DynamicPresentationSource[],
	): StagedObjectVisualTemplateOwner<TOwnerId>;
	dropOwner(ownerId: TOwnerId): void;
	getDiagnostics(): ObjectVisualTemplateRepositoryDiagnostics;
	destroy(): Promise<void>;
}

type TemplateState<TClaim extends ObjectVisualTemplateAtlasClaim> =
	| {
			readonly kind: "preparing";
			readonly completion: Promise<ObjectVisualTemplate>;
	  }
	| {
			readonly atlasClaim: TClaim;
			readonly kind: "ready";
			readonly template: ObjectVisualTemplate;
	  }
	| { readonly kind: "failed"; readonly cause: unknown };

interface TemplateEntry<
	TOwnerId extends string,
	TClaim extends ObjectVisualTemplateAtlasClaim,
> {
	readonly fingerprint: string;
	readonly key: ObjectVisualTemplateKey;
	readonly owners: Set<TOwnerId>;
	stagingReferenceCount: number;
	state: TemplateState<TClaim>;
}

interface TemplateOwnerRecord {
	readonly keys: ReadonlySet<ObjectVisualTemplateKey>;
}

/** Exact geometry ownership operations required by template residency. */
export interface ObjectVisualTemplateGeometry {
	replaceOwner(
		ownerId: ObjectVisualTemplateResourceOwnerId,
		sources: readonly GeometrySource[],
	): void;
	dropOwner(ownerId: ObjectVisualTemplateResourceOwnerId): void;
}

/** One immutable template key uses one atlas revision because changed content produces a new key. */
const OBJECT_VISUAL_TEMPLATE_ATLAS_REVISION = 1;

/** Shares immutable preparation and owns complete geometry-plus-atlas template residency. */
export class ObjectVisualTemplateRepository<
	TOwnerId extends string,
	TClaim extends ObjectVisualTemplateAtlasClaim,
> implements ObjectVisualTemplateRepositoryPort<TOwnerId> {
	readonly #geometry: ObjectVisualTemplateGeometry;
	readonly #atlas: ObjectVisualTemplateAtlas<TClaim>;
	readonly #preparer: ObjectVisualTemplatePreparer;
	readonly #entries = new Map<
		ObjectVisualTemplateKey,
		TemplateEntry<TOwnerId, TClaim>
	>();
	readonly #owners = new Map<TOwnerId, TemplateOwnerRecord>();
	readonly #pendingDisposals = new Set<Promise<void>>();
	/** Atlas cleanup failures retained for deterministic shutdown failure instead of rejection leaks. */
	readonly #releaseFailures: unknown[] = [];
	#destroyed = false;

	constructor(
		geometry: ObjectVisualTemplateGeometry,
		atlas: ObjectVisualTemplateAtlas<TClaim>,
		preparer: ObjectVisualTemplatePreparer,
	) {
		this.#geometry = geometry;
		this.#atlas = atlas;
		this.#preparer = preparer;
	}

	/** Prepare and share an exact template set without changing any committed owner. */
	stageOwner(
		sources: readonly DynamicPresentationSource[],
	): StagedObjectVisualTemplateOwner<TOwnerId> {
		if (this.#destroyed)
			throw new Error("Cannot prepare templates with a destroyed repository.");
		const requirements = new Map<
			ObjectVisualTemplateKey,
			{ readonly fingerprint: string; readonly source: DynamicPresentationSource }
		>();
		for (const source of sources) {
			const key = objectVisualTemplateKey(source);
			const fingerprint = sourceFingerprint(source);
			const requested = requirements.get(key);
			if (requested && requested.fingerprint !== fingerprint) {
				throw new Error(`Visual template ${key} has conflicting owner facts.`);
			}
			const existing = this.#entries.get(key);
			if (existing && existing.fingerprint !== fingerprint) {
				throw new Error(
					`Visual template ${key} has conflicting resolved facts.`,
				);
			}
			requirements.set(key, { fingerprint, source });
		}
		const entries = new Map<
			ObjectVisualTemplateKey,
			TemplateEntry<TOwnerId, TClaim>
		>();
		try {
			for (const [key, requirement] of requirements) {
				const entry =
					this.#entries.get(key) ??
					this.#startEntry(key, requirement.fingerprint, requirement.source);
				entry.stagingReferenceCount += 1;
				entries.set(key, entry);
			}
		} catch (cause) {
			for (const entry of entries.values()) this.#releaseStagedEntry(entry);
			throw cause;
		}
		let state: "staged" | "committed" | "released" = "staged";
		const completion = this.#completeEntries(entries);
		return {
			commit: (ownerId: TOwnerId) => {
				if (this.#destroyed)
					throw new Error("Cannot commit templates after repository shutdown.");
				if (state !== "staged")
					throw new Error(`Cannot commit a template stage in state ${state}.`);
				if (
					![...entries.values()].every((entry) => entry.state.kind === "ready")
				)
					throw new Error(
						"Cannot commit templates before preparation completes.",
					);
				this.#commitOwner(ownerId, entries);
				state = "committed";
				for (const entry of entries.values()) this.#releaseStagedEntry(entry);
			},
			completion,
			release: () => {
				if (state === "released" || state === "committed") return;
				state = "released";
				for (const entry of entries.values()) this.#releaseStagedEntry(entry);
			},
		};
	}

	dropOwner(ownerId: TOwnerId): void {
		this.#dropOwnerRecord(ownerId);
	}

	/** Inspect one logical template's explicit preparation state without exposing its payload. */
	getState(key: ObjectVisualTemplateKey): TemplateState<TClaim>["kind"] | null {
		return this.#entries.get(key)?.state.kind ?? null;
	}

	getDiagnostics(): ObjectVisualTemplateRepositoryDiagnostics {
		const states = [...this.#entries.values()].map((entry) => entry.state.kind);
		return {
			failedTemplateCount: states.filter((state) => state === "failed").length,
			preparingTemplateCount: states.filter((state) => state === "preparing")
				.length,
			readyTemplateCount: states.filter((state) => state === "ready").length,
			templateCount: states.length,
		};
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const ownerId of [...this.#owners.keys()]) this.dropOwner(ownerId);
		const preparations = [...this.#entries.values()].flatMap((entry) =>
			entry.state.kind === "preparing" ? [entry.state.completion] : [],
		);
		for (const entry of this.#entries.values()) {
			if (entry.state.kind === "ready") {
				this.#disposeReadyEntry(entry.key, entry.state.atlasClaim);
			}
		}
		this.#entries.clear();
		await this.#preparer.destroy();
		await Promise.allSettled(preparations);
		await Promise.allSettled([...this.#pendingDisposals]);
		if (this.#releaseFailures.length > 0) {
			throw new AggregateError(
				this.#releaseFailures,
				"One or more visual-template atlas claims failed to release.",
			);
		}
	}

	#startEntry(
		key: ObjectVisualTemplateKey,
		fingerprint: string,
		source: DynamicPresentationSource,
	): TemplateEntry<TOwnerId, TClaim> {
		const entry: TemplateEntry<TOwnerId, TClaim> = {
			fingerprint,
			key,
			owners: new Set(),
			stagingReferenceCount: 0,
			state: { kind: "failed", cause: new Error("Preparation did not start.") },
		};
		const completion = this.#prepareEntry(entry, source);
		entry.state = { completion, kind: "preparing" };
		this.#entries.set(key, entry);
		return entry;
	}

	async #prepareEntry(
		entry: TemplateEntry<TOwnerId, TClaim>,
		source: DynamicPresentationSource,
	): Promise<ObjectVisualTemplate> {
		let atlasClaim: TClaim | null = null;
		let geometryRetained = false;
		const resourceOwner = objectVisualTemplateResourceOwnerId(entry.key);
		try {
			const template = await this.#preparer.prepare(source);
			if (template.key !== entry.key) {
				throw new Error(
					`Visual preparer returned ${template.key} for requested ${entry.key}.`,
				);
			}
			if (!this.#entryIsRetained(entry)) return template;

			geometryRetained = true;
			this.#geometry.replaceOwner(resourceOwner, template.geometry);
			atlasClaim = this.#atlas.prepareOwnerRequirements(
				resourceOwner,
				OBJECT_VISUAL_TEMPLATE_ATLAS_REVISION,
				template.textureRequirements,
			);
			const atlasCompletion = await atlasClaim.completion;
			if (atlasCompletion !== "ready") {
				throw new Error(
					`Visual template ${entry.key} atlas claim ${atlasCompletion === "withdrawn" ? "was withdrawn" : `failed: ${String(atlasCompletion.cause)}`}.`,
				);
			}
			if (!this.#entryIsRetained(entry)) {
				const releasedClaim = atlasClaim;
				atlasClaim = null;
				geometryRetained = false;
				await this.#releasePreparedResources(
					resourceOwner,
					releasedClaim,
					true,
				);
				return template;
			}
			await this.#atlas.activateOwnerRevision(atlasClaim);
			if (!this.#entryIsRetained(entry)) {
				const releasedClaim = atlasClaim;
				atlasClaim = null;
				geometryRetained = false;
				await this.#releasePreparedResources(
					resourceOwner,
					releasedClaim,
					true,
				);
				return template;
			}
			entry.state = { atlasClaim, kind: "ready", template };
			return template;
		} catch (cause) {
			const releasedClaim = atlasClaim;
			const releasedGeometry = geometryRetained;
			let failure = cause;
			try {
				await this.#releasePreparedResources(
					resourceOwner,
					releasedClaim,
					releasedGeometry,
				);
			} catch (cleanupCause) {
				failure = new AggregateError(
					[cause, cleanupCause],
					`Visual template ${entry.key} preparation and rollback both failed.`,
				);
			}
			if (this.#entries.get(entry.key) === entry) {
				entry.state = { cause: failure, kind: "failed" };
			}
			throw failure;
		}
	}

	async #releasePreparedResources(
		resourceOwner: ObjectVisualTemplateResourceOwnerId,
		atlasClaim: TClaim | null,
		geometryRetained: boolean,
	): Promise<void> {
		const failures: unknown[] = [];
		if (atlasClaim) {
			try {
				await this.#atlas.withdrawOwnerRevision(atlasClaim);
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (geometryRetained) {
			try {
				this.#geometry.dropOwner(resourceOwner);
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Visual template resources for ${resourceOwner} could not be released.`,
			);
		}
	}

	async #completeEntries(
		entries: ReadonlyMap<
			ObjectVisualTemplateKey,
			TemplateEntry<TOwnerId, TClaim>
		>,
	): Promise<ReadonlyMap<ObjectVisualTemplateKey, ObjectVisualTemplate>> {
		const templates = await Promise.all(
			[...entries.values()].map((entry) => this.#entryCompletion(entry)),
		);
		return new Map(templates.map((template) => [template.key, template]));
	}

	#entryCompletion(
		entry: TemplateEntry<TOwnerId, TClaim>,
	): Promise<ObjectVisualTemplate> {
		if (entry.state.kind === "preparing") return entry.state.completion;
		if (entry.state.kind === "ready")
			return Promise.resolve(entry.state.template);
		return Promise.reject(entry.state.cause);
	}

	#commitOwner(
		ownerId: TOwnerId,
		entries: ReadonlyMap<
			ObjectVisualTemplateKey,
			TemplateEntry<TOwnerId, TClaim>
		>,
	): void {
		for (const entry of entries.values()) {
			if (entry.state.kind !== "ready")
				throw new Error(`Template ${entry.key} is not ready for commit.`);
		}
		for (const entry of entries.values()) entry.owners.add(ownerId);
		const previous = this.#owners.get(ownerId);
		for (const key of previous?.keys ?? []) {
			if (entries.has(key)) continue;
			const entry = this.#entries.get(key);
			entry?.owners.delete(ownerId);
			if (entry) this.#removeUnusedEntry(entry);
		}
		this.#owners.set(ownerId, {
			keys: new Set(entries.keys()),
		});
	}

	#dropOwnerRecord(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (owner) {
			for (const key of owner.keys) {
				const entry = this.#entries.get(key);
				if (!entry) continue;
				entry.owners.delete(ownerId);
				this.#removeUnusedEntry(entry);
			}
			this.#owners.delete(ownerId);
		}
	}

	#releaseStagedEntry(entry: TemplateEntry<TOwnerId, TClaim>): void {
		if (entry.stagingReferenceCount <= 0)
			throw new Error(
				`Template ${entry.key} has no staged reference to release.`,
			);
		entry.stagingReferenceCount -= 1;
		this.#removeUnusedEntry(entry);
	}

	#removeUnusedEntry(entry: TemplateEntry<TOwnerId, TClaim>): void {
		if (entry.owners.size === 0 && entry.stagingReferenceCount === 0) {
			if (this.#entries.get(entry.key) !== entry) return;
			this.#entries.delete(entry.key);
			if (entry.state.kind === "ready") {
				this.#disposeReadyEntry(entry.key, entry.state.atlasClaim);
			}
		}
	}

	#entryIsRetained(entry: TemplateEntry<TOwnerId, TClaim>): boolean {
		return (
			!this.#destroyed &&
			this.#entries.get(entry.key) === entry &&
			(entry.owners.size > 0 || entry.stagingReferenceCount > 0)
		);
	}

	#disposeReadyEntry(key: ObjectVisualTemplateKey, atlasClaim: TClaim): void {
		const disposal = this.#atlas
			.withdrawOwnerRevision(atlasClaim)
			.catch((cause: unknown) => {
				this.#releaseFailures.push(cause);
			})
			.finally(() => this.#pendingDisposals.delete(disposal));
		this.#pendingDisposals.add(disposal);
		this.#geometry.dropOwner(objectVisualTemplateResourceOwnerId(key));
	}
}

/** Derive the private device-resource owner for one immutable template. */
function objectVisualTemplateResourceOwnerId(
	key: ObjectVisualTemplateKey,
): ObjectVisualTemplateResourceOwnerId {
	return `object-visual-template-resource:${key}`;
}

/** Derive canonical template identity exclusively from immutable resolved content facts. */
export function objectVisualTemplateKey(
	source: DynamicPresentationSource,
): ObjectVisualTemplateKey {
	return `object-visual-template:${source.setupId}/${source.presentation.appearanceKey}` as ObjectVisualTemplateKey;
}

function partVisualTemplateKey(
	templateKey: ObjectVisualTemplateKey,
	part: ResolvedObjectPart,
): PartVisualTemplateKey {
	return `part-visual-template:${templateKey}/part:${part.partIndex}/${part.geometry.id}` as PartVisualTemplateKey;
}

function prepareObjectVisualTemplate(
	source: DynamicPresentationSource,
): ObjectVisualTemplate {
	const key = objectVisualTemplateKey(source);
	const textureRequirements = new Map<AssetTextureKey, AssetTextureFact>();
	const geometry = new Map<ObjectGeometryKey, GeometrySource>();
	const parts = source.presentation.parts.map((part) => {
		const geometryKey = createObjectGeometryKey(part.geometry.id);
		if (!geometry.has(geometryKey)) {
			geometry.set(geometryKey, {
				geometry: objectGeometryData(part),
				key: geometryKey,
			});
		}
		const templatePartKey = partVisualTemplateKey(key, part);
		return {
			defaultScale: part.defaultScale,
			drawUnits: materialPartitions(
				part,
				geometryKey,
				templatePartKey,
				textureRequirements,
			),
			geometry: geometryKey,
			key: templatePartKey,
			localBounds: part.geometry.bounds,
			partIndex: part.partIndex,
		};
	});
	return {
		appearanceKey: source.presentation.appearanceKey,
		baseBounds: source.localBounds ?? source.presentation.selectionBounds,
		geometry: [...geometry.values()],
		key,
		parts,
		textureRequirements: [...textureRequirements.values()].sort((left, right) =>
			left.key.localeCompare(right.key),
		),
	};
}

function materialPartitions(
	part: ResolvedObjectPart,
	geometry: ObjectGeometryKey,
	templatePartKey: PartVisualTemplateKey,
	textureRequirements: Map<AssetTextureKey, AssetTextureFact>,
): readonly RigidPartDrawUnit[] {
	return resolveObjectMaterialRanges(
		part,
		`Object part ${part.partIndex}`,
		textureRequirements,
	).map((range) => ({
		batchKey: `${templatePartKey}/${range.bindingId}/${range.indexStart}/${range.indexCount}`,
		geometry,
		indexCount: range.indexCount,
		indexStart: range.indexStart,
		material: range.material,
		ordering: range.ordering,
		partIndex: part.partIndex,
		templatePartKey,
	}));
}

function objectGeometryData(part: ResolvedObjectPart): ObjectGeometryData {
	return {
		// Dynamic entities are lit at draw time, never baked; retail likewise lights them
		// through hardware light slots rather than burning them into their meshes.
		bakedLight: null,
		indices: part.geometry.indices,
		kind: "object",
		normals: part.geometry.normals,
		positions: part.geometry.positions,
		textureCoordinates: part.geometry.textureCoordinates,
	};
}

function sourceFingerprint(source: DynamicPresentationSource): string {
	return JSON.stringify({
		appearanceKey: source.presentation.appearanceKey,
		parts: source.presentation.parts.map((part) => ({
			defaultScale: part.defaultScale,
			geometry: part.geometry.id,
			materials: part.materials.map(({ id }) => id),
			partIndex: part.partIndex,
		})),
		presentation: source.presentation.id,
		setup: source.setupId,
	});
}
