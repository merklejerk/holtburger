import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import {
	createObjectGeometryKey,
	type GeometrySource,
	type ObjectGeometryKey,
} from "../geometry/types";
import { resolveObjectTriangleMaterial } from "../commit/object-material-binding";
import type { ResolvedObjectPart } from "../resolution/presentation";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { AABB3, Vec3 } from "../math/types";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import { addAssetTextureFacts } from "../textures/texture-facts";
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
	prepare(source: AuthoredDynamicSource): Promise<ObjectVisualTemplate>;
	destroy(): Promise<void>;
}

/** Main-thread preparer used until visual-template work moves behind a worker boundary. */
export class InlineObjectVisualTemplatePreparer implements ObjectVisualTemplatePreparer {
	async prepare(source: AuthoredDynamicSource): Promise<ObjectVisualTemplate> {
		return prepareObjectVisualTemplate(source);
	}

	async destroy(): Promise<void> {}
}

/** Prepared owner requirements that do not disturb the active owner until explicit commit. */
export interface StagedObjectVisualTemplateOwner<TOwnerId extends string> {
	readonly completion: Promise<
		ReadonlyMap<ObjectVisualTemplateKey, ObjectVisualTemplate>
	>;
	commit(ownerId: TOwnerId): void;
	release(): void;
}

type TemplateState =
	| {
			readonly kind: "preparing";
			readonly completion: Promise<ObjectVisualTemplate>;
	  }
	| { readonly kind: "ready"; readonly template: ObjectVisualTemplate }
	| { readonly kind: "failed"; readonly cause: unknown };

interface TemplateEntry<TOwnerId extends string> {
	readonly fingerprint: string;
	readonly key: ObjectVisualTemplateKey;
	readonly owners: Set<TOwnerId>;
	stagingReferenceCount: number;
	state: TemplateState;
}

interface TemplateOwnerRecord {
	readonly keys: ReadonlySet<ObjectVisualTemplateKey>;
}

/** Exact geometry ownership operations required by visual-template publication. */
interface ObjectVisualTemplateGeometry<TOwnerId extends string> {
	replaceOwner(ownerId: TOwnerId, sources: readonly GeometrySource[]): void;
	dropOwner(ownerId: TOwnerId): void;
}

/** Shares immutable preparation while retaining device geometry only for current owner sets. */
export class ObjectVisualTemplateManager<TOwnerId extends string> {
	readonly #geometry: ObjectVisualTemplateGeometry<TOwnerId>;
	readonly #preparer: ObjectVisualTemplatePreparer;
	readonly #entries = new Map<
		ObjectVisualTemplateKey,
		TemplateEntry<TOwnerId>
	>();
	readonly #owners = new Map<TOwnerId, TemplateOwnerRecord>();
	#destroyed = false;

	constructor(
		geometry: ObjectVisualTemplateGeometry<TOwnerId>,
		preparer: ObjectVisualTemplatePreparer,
	) {
		this.#geometry = geometry;
		this.#preparer = preparer;
	}

	/** Prepare and share an exact template set without changing any committed owner. */
	stageOwner(
		sources: readonly AuthoredDynamicSource[],
	): StagedObjectVisualTemplateOwner<TOwnerId> {
		if (this.#destroyed)
			throw new Error("Cannot prepare templates with a destroyed manager.");
		const requirements = new Map<
			ObjectVisualTemplateKey,
			{ readonly fingerprint: string; readonly source: AuthoredDynamicSource }
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
		const entries = new Map<ObjectVisualTemplateKey, TemplateEntry<TOwnerId>>();
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
					throw new Error("Cannot commit templates after manager shutdown.");
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
	getState(key: ObjectVisualTemplateKey): TemplateState["kind"] | null {
		return this.#entries.get(key)?.state.kind ?? null;
	}

	getDiagnostics() {
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
		await this.#preparer.destroy();
		await Promise.allSettled(
			[...this.#entries.values()].flatMap((entry) =>
				entry.state.kind === "preparing" ? [entry.state.completion] : [],
			),
		);
		this.#entries.clear();
	}

	#startEntry(
		key: ObjectVisualTemplateKey,
		fingerprint: string,
		source: AuthoredDynamicSource,
	): TemplateEntry<TOwnerId> {
		const entry: TemplateEntry<TOwnerId> = {
			fingerprint,
			key,
			owners: new Set(),
			stagingReferenceCount: 0,
			state: { kind: "failed", cause: new Error("Preparation did not start.") },
		};
		const completion = this.#preparer
			.prepare(source)
			.then((template) => {
				if (template.key !== key) {
					throw new Error(
						`Visual preparer returned ${template.key} for requested ${key}.`,
					);
				}
				if (
					this.#entries.get(key) !== entry ||
					(entry.owners.size === 0 && entry.stagingReferenceCount === 0)
				)
					return template;
				entry.state = { kind: "ready", template };
				return template;
			})
			.catch((cause: unknown) => {
				if (this.#entries.get(key) === entry)
					entry.state = { kind: "failed", cause };
				throw cause;
			});
		entry.state = { completion, kind: "preparing" };
		this.#entries.set(key, entry);
		return entry;
	}

	async #completeEntries(
		entries: ReadonlyMap<ObjectVisualTemplateKey, TemplateEntry<TOwnerId>>,
	): Promise<ReadonlyMap<ObjectVisualTemplateKey, ObjectVisualTemplate>> {
		const templates = await Promise.all(
			[...entries.values()].map((entry) => this.#entryCompletion(entry)),
		);
		return new Map(templates.map((template) => [template.key, template]));
	}

	#entryCompletion(
		entry: TemplateEntry<TOwnerId>,
	): Promise<ObjectVisualTemplate> {
		if (entry.state.kind === "preparing") return entry.state.completion;
		if (entry.state.kind === "ready")
			return Promise.resolve(entry.state.template);
		return Promise.reject(entry.state.cause);
	}

	#commitOwner(
		ownerId: TOwnerId,
		entries: ReadonlyMap<ObjectVisualTemplateKey, TemplateEntry<TOwnerId>>,
	): void {
		const templates = [...entries.values()].map((entry) => {
			if (entry.state.kind !== "ready")
				throw new Error(`Template ${entry.key} is not ready for commit.`);
			return entry.state.template;
		});
		this.#geometry.replaceOwner(
			ownerId,
			templates.flatMap((template) => template.geometry),
		);
		const previous = this.#owners.get(ownerId);
		for (const key of previous?.keys ?? []) {
			if (entries.has(key)) continue;
			const entry = this.#entries.get(key);
			entry?.owners.delete(ownerId);
			if (entry) this.#removeUnusedEntry(entry);
		}
		for (const entry of entries.values()) entry.owners.add(ownerId);
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
		this.#geometry.dropOwner(ownerId);
	}

	#releaseStagedEntry(entry: TemplateEntry<TOwnerId>): void {
		if (entry.stagingReferenceCount <= 0)
			throw new Error(
				`Template ${entry.key} has no staged reference to release.`,
			);
		entry.stagingReferenceCount -= 1;
		this.#removeUnusedEntry(entry);
	}

	#removeUnusedEntry(entry: TemplateEntry<TOwnerId>): void {
		if (entry.owners.size === 0 && entry.stagingReferenceCount === 0) {
			this.#entries.delete(entry.key);
		}
	}
}

/** Derive canonical template identity exclusively from immutable resolved content facts. */
export function objectVisualTemplateKey(
	source: AuthoredDynamicSource,
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
	source: AuthoredDynamicSource,
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
	if (part.geometry.indices.length % 3 !== 0) {
		throw new Error(`Object part ${part.partIndex} indices are not triangles.`);
	}
	const triangleCount = part.geometry.indices.length / 3;
	if (part.geometry.materialSlotIndices.length !== triangleCount) {
		throw new Error(
			`Object part ${part.partIndex} material slots do not cover its triangles.`,
		);
	}
	const ranges: Array<
		Omit<RigidPartDrawUnit, "batchKey"> & { readonly bindingId: string }
	> = [];
	for (let triangle = 0; triangle < triangleCount; triangle += 1) {
		const resolved = resolveObjectTriangleMaterial({
			detailRole: null,
			geometry: part.geometry,
			materials: part.materials,
			sourceLabel: `Object part ${part.partIndex}`,
			triangle,
		});
		addAssetTextureFacts(
			textureRequirements,
			resolved.textureRequirements,
			`Object part ${part.partIndex}`,
		);
		const previous = ranges.at(-1);
		if (
			previous?.bindingId === resolved.bindingId &&
			previous.indexStart + previous.indexCount === triangle * 3
		) {
			ranges[ranges.length - 1] = {
				...previous,
				indexCount: previous.indexCount + 3,
			};
			continue;
		}
		ranges.push({
			bindingId: resolved.bindingId,
			geometry,
			indexCount: 3,
			indexStart: triangle * 3,
			material: resolved.binding,
			ordering: resolved.ordering,
			partIndex: part.partIndex,
			templatePartKey,
		});
	}
	return ranges.map((range) => ({
		batchKey: `${range.templatePartKey}/${range.bindingId}/${range.indexStart}/${range.indexCount}`,
		geometry: range.geometry,
		indexCount: range.indexCount,
		indexStart: range.indexStart,
		material: range.material,
		ordering: range.ordering,
		partIndex: range.partIndex,
		templatePartKey: range.templatePartKey,
	}));
}

function objectGeometryData(part: ResolvedObjectPart): ObjectGeometryData {
	return {
		indices: part.geometry.indices,
		kind: "object",
		normals: part.geometry.normals,
		positions: part.geometry.positions,
		textureCoordinates: part.geometry.textureCoordinates,
	};
}

function sourceFingerprint(source: AuthoredDynamicSource): string {
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
