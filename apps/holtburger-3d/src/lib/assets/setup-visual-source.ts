import type { DecodedStaticPresentation } from "./decode-static-source-record";

/** Lossless ObjDesc appearance facts accepted by every SetupModel consumer. */
export interface SetupVisualAppearance {
	readonly paletteDid: number | null;
	readonly subPalettes: readonly {
		readonly paletteDid: number;
		readonly offset: number;
		readonly colorCount: number;
	}[];
	readonly textureChanges: readonly {
		readonly partIndex: number;
		readonly oldTextureDid: number;
		readonly newTextureDid: number;
	}[];
	readonly partChanges: readonly {
		readonly partIndex: number;
		readonly gfxObjDid: number;
	}[];
}

/** Async content boundary for one exact SetupModel appearance. */
export interface SetupVisualSource {
	load(
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<DecodedStaticPresentation>;
	/** Stop queued content work when the owning presentation is torn down. */
	destroy?(): void;
}
