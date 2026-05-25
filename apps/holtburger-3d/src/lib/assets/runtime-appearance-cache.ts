export interface RuntimeAppearanceInput {
	setupModelId: number;
	objDesc: RuntimeObjDesc | null;
}

interface RuntimeObjDesc {
	paletteId: number | null;
	subPalettes: readonly RuntimeSubPalette[];
	textureChanges: readonly RuntimeTextureChange[];
	animPartChanges: readonly RuntimeAnimPartChange[];
}

interface RuntimeSubPalette {
	subId: number;
	offset: number;
	numColors: number;
}

interface RuntimeTextureChange {
	partIndex: number;
	oldTexture: number;
	newTexture: number;
}

interface RuntimeAnimPartChange {
	partIndex: number;
	partId: number;
}

export interface RuntimeAppearanceResolvedFacts {
	setupModelId: number;
	appearanceKey: string;
	selectedGfxObjAssetIds: readonly string[];
	materialAssetIds: readonly string[];
	paletteAssetIds: readonly string[];
	textureChanges: readonly RuntimeTextureChange[];
	animPartChanges: readonly RuntimeAnimPartChange[];
	paletteId: number | null;
	subPalettes: readonly RuntimeSubPalette[];
	selectedPartsSignature: string | null;
	textureSwapSignature: string | null;
	paletteViewSignature: string | null;
}

export interface RuntimeAppearanceCacheOptions {
	maxEntries: number;
}

export interface RuntimeAppearanceCacheDiagnostics {
	maxEntries: number;
	size: number;
	hits: number;
	misses: number;
	evictions: number;
	inFlight: number;
	distinctObjDescKeys: number;
}

export type RuntimeAppearanceResolver<T> = (
	input: RuntimeAppearanceInput,
) => Promise<T>;

interface RuntimeAppearanceCacheEntry<T> {
	key: string;
	objDescKey: string;
	value: T;
}

export class RuntimeAppearanceCache<
	T extends RuntimeAppearanceResolvedFacts = RuntimeAppearanceResolvedFacts,
> {
	private readonly entries = new Map<string, RuntimeAppearanceCacheEntry<T>>();
	private readonly inFlight = new Map<string, Promise<T>>();
	private hits = 0;
	private misses = 0;
	private evictions = 0;

	constructor(private readonly options: RuntimeAppearanceCacheOptions) {
		if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
			throw new Error("runtime appearance cache maxEntries must be positive.");
		}
	}

	async getOrResolve(
		input: RuntimeAppearanceInput,
		resolver: RuntimeAppearanceResolver<T>,
	): Promise<T> {
		const key = describeRuntimeAppearanceKey(input);
		const existing = this.entries.get(key);
		if (existing) {
			this.hits += 1;
			this.entries.delete(key);
			this.entries.set(key, existing);
			return existing.value;
		}

		const existingInFlight = this.inFlight.get(key);
		if (existingInFlight) {
			this.hits += 1;
			return existingInFlight;
		}

		this.misses += 1;
		const pending = resolver(input)
			.then((value) => {
				this.store(key, describeRuntimeObjDescKey(input.objDesc), value);
				return value;
			})
			.finally(() => {
				this.inFlight.delete(key);
			});
		this.inFlight.set(key, pending);
		return pending;
	}

	peek(input: RuntimeAppearanceInput): T | null {
		return this.entries.get(describeRuntimeAppearanceKey(input))?.value ?? null;
	}

	clear(): void {
		this.entries.clear();
		this.inFlight.clear();
	}

	diagnostics(): RuntimeAppearanceCacheDiagnostics {
		return {
			maxEntries: this.options.maxEntries,
			size: this.entries.size,
			hits: this.hits,
			misses: this.misses,
			evictions: this.evictions,
			inFlight: this.inFlight.size,
			distinctObjDescKeys: new Set(
				[...this.entries.values()].map((entry) => entry.objDescKey),
			).size,
		};
	}

	private store(key: string, objDescKey: string, value: T): void {
		this.entries.set(key, { key, objDescKey, value });

		while (this.entries.size > this.options.maxEntries) {
			const oldestKey = this.entries.keys().next().value as string | undefined;
			if (!oldestKey) {
				return;
			}
			this.entries.delete(oldestKey);
			this.evictions += 1;
		}
	}
}

export function describeRuntimeAppearanceKey(
	input: RuntimeAppearanceInput,
): string {
	return `setup:${formatHex32(input.setupModelId)}|${describeRuntimeObjDescKey(input.objDesc)}`;
}

function describeRuntimeObjDescKey(objDesc: RuntimeObjDesc | null): string {
	if (!objDesc) {
		return "obj-desc:base";
	}

	return [
		`pal=${objDesc.paletteId === null ? "none" : formatHex32(objDesc.paletteId)}`,
		`sub=[${objDesc.subPalettes
			.map(
				(subPalette) =>
					`${formatHex32(subPalette.subId)}:${formatHex32(subPalette.offset)}:${formatHex32(subPalette.numColors)}`,
			)
			.join(",")}]`,
		`tex=[${objDesc.textureChanges
			.map(
				(change) =>
					`${change.partIndex}:${formatHex32(change.oldTexture)}->${formatHex32(change.newTexture)}`,
			)
			.join(",")}]`,
		`anim=[${objDesc.animPartChanges
			.map((change) => `${change.partIndex}:${formatHex32(change.partId)}`)
			.join(",")}]`,
	].join("|");
}

function formatHex32(value: number): string {
	return Math.trunc(value).toString(16).padStart(8, "0").toUpperCase();
}
