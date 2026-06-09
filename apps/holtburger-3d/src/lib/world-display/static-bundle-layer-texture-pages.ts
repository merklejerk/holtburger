import type {
	StaticBundleTexturePage,
	VirtualTexturePageRef,
} from "./static-bundle-layer";
import {
	planAtlasLayout,
	type AtlasLayoutPolicy,
} from "./texture-pages/atlas-layout-planner";
import {
	deriveStaticTexturePageBucket,
	type TexturePageDescriptor,
} from "./texture-pages/texture-page-binding";

interface StaticBundleSourceTexturePagePlacement {
	key: string;
	sourceAssetId: string;
	role: VirtualTexturePageRef["role"];
	sampleClass: VirtualTexturePageRef["sampleClass"];
	indexedFormat: VirtualTexturePageRef["indexedFormat"];
	width: number;
	height: number;
	samplingDomain: VirtualTexturePageRef["samplingDomain"];
	lookup: VirtualTexturePageRef["lookup"];
	refs: readonly VirtualTexturePageRef[];
}

export function buildStaticBundleLayerTexturePages(options: {
	scopeKey: string;
	texturePageRefs: readonly VirtualTexturePageRef[];
	policy: AtlasLayoutPolicy;
}): StaticBundleTexturePage[] {
	const refsByBucket = groupTextureRefsByBucket(options.texturePageRefs);
	const pages: StaticBundleTexturePage[] = [];
	for (const refs of refsByBucket.values()) {
		const sourcePlacements = groupTextureRefsBySourcePlacement(refs);
		if (sourcePlacements.length === 1) {
			const sourcePlacement = sourcePlacements[0];
			if (sourcePlacement) {
				pages.push(
					createSingleEntryTexturePage(options.scopeKey, sourcePlacement),
				);
			}
			continue;
		}
		const layout = planAtlasLayout({
			entries: sourcePlacements.map((sourcePlacement) => ({
				key: sourcePlacement.key,
				width: sourcePlacement.width,
				height: sourcePlacement.height,
			})),
			policy: options.policy,
		});
		for (const texturePage of layout.texturePages) {
			const placements = texturePage.placements
				.map((placement) => {
					const sourcePlacement = sourcePlacements.find(
						(candidate) => candidate.key === placement.atlasEntryKey,
					);
					if (!sourcePlacement) {
						throw new Error(
							`Texture page placement references missing source placement ${placement.atlasEntryKey}.`,
						);
					}
					return { placement, sourcePlacement };
				})
				.sort((left, right) =>
					left.sourcePlacement.key.localeCompare(right.sourcePlacement.key),
				);
			const sampleClass = placements[0]?.sourcePlacement.sampleClass;
			const indexedFormat = placements[0]?.sourcePlacement.indexedFormat;
			if (!sampleClass) {
				continue;
			}
			const pageBucket = resolveStaticTexturePageBucketForRefs(
				placements.map(({ sourcePlacement }) => sourcePlacement.refs[0]),
			);
			pages.push({
				key: `${options.scopeKey}:page:${pageBucket}:${texturePage.textureIndex}`,
				scopeKey: options.scopeKey,
				bucket: pageBucket,
				pageKind: "packed-atlas",
				sampleClass,
				indexedFormat,
				width: texturePage.width,
				height: texturePage.height,
				bytes: packAtlasBytes(
					texturePage.width,
					texturePage.height,
					placements,
				),
				entries: placements.map(({ placement, sourcePlacement }) => ({
					sourcePlacementKey: sourcePlacement.key,
					virtualRefKey: sourcePlacement.refs[0]?.key ?? sourcePlacement.key,
					virtualRefKeys: sourcePlacement.refs.map((ref) => ref.key),
					sourceAssetId: sourcePlacement.sourceAssetId,
					role: sourcePlacement.role,
					sampleClass: sourcePlacement.sampleClass,
					indexedFormat: sourcePlacement.indexedFormat,
					samplingDomain: sourcePlacement.samplingDomain,
					lookup: sourcePlacement.lookup,
					rect: [
						placement.x,
						placement.y,
						placement.width,
						placement.height,
					],
				})),
			});
		}
		for (const overflow of layout.overflows) {
			const sourcePlacement = sourcePlacements.find(
				(candidate) => candidate.key === overflow.atlasEntryKey,
			);
			if (sourcePlacement) {
				pages.push(
					createSingleEntryTexturePage(options.scopeKey, sourcePlacement),
				);
			}
		}
	}
	return pages.sort((left, right) => left.key.localeCompare(right.key));
}

export function describeStaticBundleSourceTexturePagePlacementKey(
	ref: VirtualTexturePageRef,
): string {
	return [
		`source:${ref.sourceAssetId}`,
		`role:${ref.role}`,
		`sample:${ref.sampleClass}`,
		`indexed:${ref.indexedFormat ?? "none"}`,
		`size:${ref.width}x${ref.height}`,
		`domain:${ref.samplingDomain}`,
		`lookup:${ref.lookup}`,
		`bytes:${describeTextureRefByteIdentity(ref)}`,
	].join(";");
}

export function createStaticBundleTexturePageDescriptor(
	ref: VirtualTexturePageRef,
): TexturePageDescriptor {
	return {
		pageKind: "single-entry",
		role: ref.role,
		sampleClass: ref.sampleClass,
		rect: [0, 0, ref.width, ref.height],
		width: ref.width,
		height: ref.height,
		wrapS: ref.wrapS,
		wrapT: ref.wrapT,
		sampling: {
			wrapS: ref.wrapS,
			wrapT: ref.wrapT,
			minFilter: ref.samplingDomain === "data" ? "nearest" : "linear",
			magFilter: ref.samplingDomain === "data" ? "nearest" : "linear",
			mip: "none",
			samplingDomain: ref.samplingDomain,
			lookup: ref.lookup,
		},
		source:
			ref.role === "detail"
				? "detail-overlay"
				: "standalone-direct-texture",
	};
}

function groupTextureRefsByBucket(
	refs: readonly VirtualTexturePageRef[],
): Map<string, VirtualTexturePageRef[]> {
	const refsByBucket = new Map<string, VirtualTexturePageRef[]>();
	for (const ref of refs) {
		const pageBucket = deriveStaticTexturePageBucket({
			role: ref.role,
			sampleClass: ref.sampleClass,
		});
		const key = `${pageBucket}:${ref.sampleClass}:${ref.indexedFormat ?? "none"}`;
		const bucketRefs = refsByBucket.get(key);
		if (bucketRefs) {
			bucketRefs.push(ref);
		} else {
			refsByBucket.set(key, [ref]);
		}
	}
	return refsByBucket;
}

function groupTextureRefsBySourcePlacement(
	refs: readonly VirtualTexturePageRef[],
): StaticBundleSourceTexturePagePlacement[] {
	const refsBySourcePlacement = new Map<string, VirtualTexturePageRef[]>();
	for (const ref of refs) {
		const sourcePlacementKey =
			describeStaticBundleSourceTexturePagePlacementKey(ref);
		const sourceRefs = refsBySourcePlacement.get(sourcePlacementKey);
		if (sourceRefs) {
			sourceRefs.push(ref);
		} else {
			refsBySourcePlacement.set(sourcePlacementKey, [ref]);
		}
	}
	return [...refsBySourcePlacement.entries()]
		.map(([key, sourceRefs]) => createSourcePlacement(key, sourceRefs))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function createSourcePlacement(
	key: string,
	refs: readonly VirtualTexturePageRef[],
): StaticBundleSourceTexturePagePlacement {
	const [firstRef] = refs;
	if (!firstRef) {
		throw new Error(`Texture page source placement ${key} has no refs.`);
	}
	validateSourcePlacementRefs(key, refs);
	return {
		key,
		sourceAssetId: firstRef.sourceAssetId,
		role: firstRef.role,
		sampleClass: firstRef.sampleClass,
		indexedFormat: firstRef.indexedFormat,
		width: firstRef.width,
		height: firstRef.height,
		samplingDomain: firstRef.samplingDomain,
		lookup: firstRef.lookup,
		refs: [...refs].sort((left, right) => left.key.localeCompare(right.key)),
	};
}

function validateSourcePlacementRefs(
	sourcePlacementKey: string,
	refs: readonly VirtualTexturePageRef[],
): void {
	const [firstRef] = refs;
	if (!firstRef) {
		throw new Error(`Texture page source placement ${sourcePlacementKey} has no refs.`);
	}
	for (const ref of refs) {
		if (
			ref.sourceAssetId !== firstRef.sourceAssetId ||
			ref.role !== firstRef.role ||
			ref.sampleClass !== firstRef.sampleClass ||
			ref.indexedFormat !== firstRef.indexedFormat ||
			ref.width !== firstRef.width ||
			ref.height !== firstRef.height ||
			ref.samplingDomain !== firstRef.samplingDomain ||
			ref.lookup !== firstRef.lookup ||
			describeTextureRefByteIdentity(ref) !== describeTextureRefByteIdentity(firstRef)
		) {
			throw new Error(
				`Texture page source placement ${sourcePlacementKey} contains incompatible refs.`,
			);
		}
	}
}

function createSingleEntryTexturePage(
	scopeKey: string,
	sourcePlacement: StaticBundleSourceTexturePagePlacement,
): StaticBundleTexturePage {
	const ref = sourcePlacement.refs[0];
	if (!ref) {
		throw new Error(
			`Texture page source placement ${sourcePlacement.key} has no canonical ref.`,
		);
	}
	return {
		key: `${scopeKey}:page:single:${sourcePlacement.key}`,
		scopeKey,
		bucket: deriveStaticTexturePageBucket({
			role: ref.role,
			sampleClass: ref.sampleClass,
		}),
		pageKind: "single-entry",
		sampleClass: ref.sampleClass,
		indexedFormat: ref.indexedFormat,
		width: ref.width,
		height: ref.height,
		bytes: ref.bytes
			? new Uint8Array(ref.bytes)
			: new Uint8Array(
					ref.width * ref.height * resolveTextureRefBytesPerPixel([ref]),
				),
		entries: [
			{
				sourcePlacementKey: sourcePlacement.key,
				virtualRefKey: ref.key,
				virtualRefKeys: sourcePlacement.refs.map((alias) => alias.key),
				sourceAssetId: ref.sourceAssetId,
				role: ref.role,
				sampleClass: ref.sampleClass,
				indexedFormat: ref.indexedFormat,
				samplingDomain: ref.samplingDomain,
				lookup: ref.lookup,
				rect: [0, 0, ref.width, ref.height],
			},
		],
	};
}

function resolveStaticTexturePageBucketForRefs(
	refs: readonly VirtualTexturePageRef[],
): StaticBundleTexturePage["bucket"] {
	const buckets = new Set(
		refs.map((ref) =>
			deriveStaticTexturePageBucket({
				role: ref.role,
				sampleClass: ref.sampleClass,
			}),
		),
	);
	if (buckets.size !== 1) {
		throw new Error("Texture page atlas cannot mix static page buckets.");
	}
	const bucket = [...buckets][0];
	if (!bucket) {
		throw new Error("Texture page atlas has no static page bucket.");
	}
	return bucket;
}

function packAtlasBytes(
	width: number,
	height: number,
	placements: readonly {
		placement: { x: number; y: number; width: number; height: number };
		sourcePlacement: StaticBundleSourceTexturePagePlacement;
	}[],
): Uint8Array {
	const bytesPerPixel = resolveTextureRefBytesPerPixel(
		placements.flatMap(({ sourcePlacement }) => sourcePlacement.refs),
	);
	const bytes = new Uint8Array(width * height * bytesPerPixel);
	for (const { placement, sourcePlacement } of placements) {
		const ref = sourcePlacement.refs[0];
		if (!ref) {
			throw new Error(
				`Texture page source placement ${sourcePlacement.key} has no canonical ref.`,
			);
		}
		if (!ref.bytes) {
			continue;
		}
		for (let row = 0; row < placement.height; row += 1) {
			const sourceOffset = row * placement.width * bytesPerPixel;
			const targetOffset =
				((placement.y + row) * width + placement.x) * bytesPerPixel;
			bytes.set(
				ref.bytes.subarray(
					sourceOffset,
					sourceOffset + placement.width * bytesPerPixel,
				),
				targetOffset,
			);
		}
	}
	return bytes;
}

function describeTextureRefByteIdentity(ref: VirtualTexturePageRef): string {
	if (!ref.bytes) {
		return "none";
	}
	return `${ref.bytes.byteLength}:${hashBytesFNV1a(ref.bytes).toString(16)}`;
}

function hashBytesFNV1a(bytes: Uint8Array): number {
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function resolveTextureRefBytesPerPixel(
	refs: readonly VirtualTexturePageRef[],
): number {
	const byteSizes = new Set(
		refs.map((ref) => {
			const expectedBytesPerPixel = resolveExpectedTextureRefBytesPerPixel(ref);
			const pixelCount = ref.width * ref.height;
			if (!ref.bytes || pixelCount <= 0) {
				return expectedBytesPerPixel;
			}
			const bytesPerPixel = ref.bytes.byteLength / pixelCount;
			if (!Number.isInteger(bytesPerPixel) || bytesPerPixel <= 0) {
				throw new Error(
					`Texture page ref ${ref.key} carries ${ref.bytes.byteLength} bytes for ${ref.width}x${ref.height}.`,
				);
			}
			if (bytesPerPixel !== expectedBytesPerPixel) {
				throw new Error(
					`Texture page ref ${ref.key} expected ${expectedBytesPerPixel} bytes per pixel for ${ref.sampleClass}${ref.indexedFormat ? ` ${ref.indexedFormat}` : ""}, got ${bytesPerPixel}.`,
				);
			}
			return bytesPerPixel;
		}),
	);
	if (byteSizes.size > 1) {
		throw new Error("Texture page atlas cannot mix byte widths in one page.");
	}
	return [...byteSizes][0] ?? 4;
}

function resolveExpectedTextureRefBytesPerPixel(
	ref: VirtualTexturePageRef,
): number {
	switch (ref.sampleClass) {
		case "rgba-color":
		case "palette-data":
			return 4;
		case "control-data":
			return 1;
		case "indexed-data":
			if (ref.indexedFormat === "p8") {
				return 1;
			}
			if (ref.indexedFormat === "index16") {
				return 2;
			}
			throw new Error(
				`Indexed texture page ref ${ref.key} is missing indexedFormat.`,
			);
	}
}
