import type { RgbaTexturePageDetailAtlasEntry } from "../compaction/compaction-family-planner";
import type { AtlasTexturePage } from "../texture-pages/atlas-layout-planner";
import type { TexturePageAtlasPlan } from "../texture-pages/texture-page-atlas-planner";
import type { TextureFilteringMode } from "../texture-pages/texture-sampling-policy";
import {
	createTextureAtlasCpuGeneration,
	describeWebgl2TextureAtlasGenerationKey,
	type TextureAtlasCpuGeneration,
	type TextureAtlasCpuGenerationPlan,
} from "../webgl2/resources/texture-atlas-generation";

export interface BuildTextureAtlasWorkerJob {
	type: "build-texture-atlas";
	key: string;
	input: BuildTextureAtlasWorkerInput;
}

export interface BuildTextureAtlasWorkerResult {
	type: "build-texture-atlas";
	key: string;
	generation: TextureAtlasCpuGeneration | null;
}

export interface BuildTextureAtlasWorkerInput extends TextureAtlasCpuGenerationPlan {
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}

export function createBuildTextureAtlasWorkerInput({
	plan,
	textureFilteringMode,
	maxAnisotropy,
}: {
	plan: TexturePageAtlasPlan;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): BuildTextureAtlasWorkerInput {
	return {
		key: plan.key,
		textureFilteringMode,
		maxAnisotropy,
		rgbaAtlasReadyDrawUnitIds: [...plan.rgbaAtlasReadyDrawUnitIds],
		detailAtlasTextures: plan.detailAtlasTextures.map(copyAtlasTexturePage),
		families: plan.families.map(copyTexturePageFamilyPlan),
		preparedTextureAssetIds: [...plan.preparedTextureAssetIds],
	};
}

export function describeBuildTextureAtlasWorkerJobKey({
	plan,
	textureFilteringMode,
	maxAnisotropy,
}: {
	plan: TextureAtlasCpuGenerationPlan;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): string {
	return describeWebgl2TextureAtlasGenerationKey({
		planKey: plan.key,
		textureFilteringMode,
		maxAnisotropy,
	});
}

export function buildTextureAtlasWorkerResult(
	input: BuildTextureAtlasWorkerInput,
): BuildTextureAtlasWorkerResult {
	const generation = createTextureAtlasCpuGeneration({
		plan: input,
		textureFilteringMode: input.textureFilteringMode,
		maxAnisotropy: input.maxAnisotropy,
	});
	return {
		type: "build-texture-atlas",
		key: describeWebgl2TextureAtlasGenerationKey({
			planKey: input.key,
			textureFilteringMode: input.textureFilteringMode,
			maxAnisotropy: input.maxAnisotropy,
		}),
		generation,
	};
}

export function collectBuildTextureAtlasInputTransferables(
	input: BuildTextureAtlasWorkerInput,
): Transferable[] {
	return uniqueTransferables(
		input.families.flatMap((familyPlan) => [
			...familyPlan.atlasEntryRecords.map(
				(record) => record.entry.level.bytes.buffer,
			),
			...familyPlan.detailAtlasEntryRecords.map(
				(record) => record.bytes.buffer,
			),
		]),
	);
}

export function collectBuildTextureAtlasResultTransferables(
	result: BuildTextureAtlasWorkerResult,
): Transferable[] {
	const generation = result.generation;
	if (!generation) {
		return [];
	}
	return uniqueTransferables([
		...generation.textures.map((texture) => texture.pixels.buffer),
		...generation.detailTextures.map((texture) => texture.pixels.buffer),
	]);
}

function copyTexturePageFamilyPlan(
	familyPlan: TexturePageAtlasPlan["families"][number],
): TexturePageAtlasPlan["families"][number] {
	return {
		family: familyPlan.family,
		atlasEntryRecords: familyPlan.atlasEntryRecords.map(copyAtlasEntryRecord),
		atlasTextures: familyPlan.atlasTextures.map(copyAtlasTexturePage),
		detailAtlasEntryRecords: familyPlan.detailAtlasEntryRecords.map(
			copyDetailAtlasEntryRecord,
		),
		detailAtlasTextures:
			familyPlan.detailAtlasTextures.map(copyAtlasTexturePage),
	};
}

function copyAtlasEntryRecord(
	record: TexturePageAtlasPlan["families"][number]["atlasEntryRecords"][number],
): TexturePageAtlasPlan["families"][number]["atlasEntryRecords"][number] {
	const levelBytes = new Uint8Array(record.entry.level.bytes);
	return {
		key: record.key,
		entry: {
			...record.entry,
			level: {
				...record.entry.level,
				byteLength: levelBytes.byteLength,
				bytes: levelBytes,
			},
		},
	};
}

function copyDetailAtlasEntryRecord(
	record: RgbaTexturePageDetailAtlasEntry,
): RgbaTexturePageDetailAtlasEntry {
	return {
		...record,
		bytes: new Uint8Array(record.bytes),
	};
}

function copyAtlasTexturePage(page: AtlasTexturePage): AtlasTexturePage {
	return {
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placements: page.placements.map((placement) => ({ ...placement })),
	};
}

function uniqueTransferables(
	buffers: readonly (ArrayBufferLike | undefined)[],
): Transferable[] {
	const transferables = new Set<Transferable>();
	for (const buffer of buffers) {
		if (buffer instanceof ArrayBuffer) {
			transferables.add(buffer);
		}
	}
	return [...transferables];
}
