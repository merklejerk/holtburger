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

export function buildStaticBundleLayerTexturePages(options: {
	scopeKey: string;
	texturePageRefs: readonly VirtualTexturePageRef[];
	policy: AtlasLayoutPolicy;
}): StaticBundleTexturePage[] {
	const refsByBucket = groupTextureRefsByBucket(options.texturePageRefs);
	const pages: StaticBundleTexturePage[] = [];
	for (const refs of refsByBucket.values()) {
		if (refs.length === 1) {
			const ref = refs[0];
			if (ref) {
				pages.push(createSingleEntryTexturePage(options.scopeKey, ref));
			}
			continue;
		}
		const layout = planAtlasLayout({
			entries: refs.map((ref) => ({
				key: ref.key,
				width: ref.width,
				height: ref.height,
			})),
			policy: options.policy,
		});
		for (const texturePage of layout.texturePages) {
			const placements = texturePage.placements
				.map((placement) => {
					const ref = refs.find(
						(candidate) => candidate.key === placement.atlasEntryKey,
					);
					if (!ref) {
						throw new Error(
							`Texture page placement references missing ref ${placement.atlasEntryKey}.`,
						);
					}
					return { placement, ref };
				})
				.sort((left, right) => left.ref.key.localeCompare(right.ref.key));
			const sampleClass = placements[0]?.ref.sampleClass;
			const indexedFormat = placements[0]?.ref.indexedFormat;
			if (!sampleClass) {
				continue;
			}
			const pageBucket = resolveStaticTexturePageBucketForRefs(
				placements.map(({ ref }) => ref),
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
				entries: placements.map(({ placement, ref }) => ({
					virtualRefKey: ref.key,
					sourceAssetId: ref.sourceAssetId,
					role: ref.role,
					sampleClass: ref.sampleClass,
					indexedFormat: ref.indexedFormat,
					wrapS: ref.wrapS,
					wrapT: ref.wrapT,
					samplingDomain: ref.samplingDomain,
					lookup: ref.lookup,
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
			const ref = refs.find(
				(candidate) => candidate.key === overflow.atlasEntryKey,
			);
			if (ref) {
				pages.push(createSingleEntryTexturePage(options.scopeKey, ref));
			}
		}
	}
	return pages.sort((left, right) => left.key.localeCompare(right.key));
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

function createSingleEntryTexturePage(
	scopeKey: string,
	ref: VirtualTexturePageRef,
): StaticBundleTexturePage {
	return {
		key: `${scopeKey}:page:single:${ref.key}`,
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
				virtualRefKey: ref.key,
				sourceAssetId: ref.sourceAssetId,
				role: ref.role,
				sampleClass: ref.sampleClass,
				indexedFormat: ref.indexedFormat,
				wrapS: ref.wrapS,
				wrapT: ref.wrapT,
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
		ref: VirtualTexturePageRef;
	}[],
): Uint8Array {
	const bytesPerPixel = resolveTextureRefBytesPerPixel(
		placements.map(({ ref }) => ref),
	);
	const bytes = new Uint8Array(width * height * bytesPerPixel);
	for (const { placement, ref } of placements) {
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
