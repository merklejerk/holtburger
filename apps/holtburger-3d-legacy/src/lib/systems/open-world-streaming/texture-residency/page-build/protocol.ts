import type { TextureBindingId } from "../../../../textures/identity";
import type { MaterialTextureDataUseIdentity } from "../../../../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../../../../textures/sampling-policy";
import type {
	WorkerHandlerInputMessage,
	WorkerHandlerOutputMessage,
	WorkerHandlerPort,
} from "../../../../workers/handler";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../../../workers/prepared-asset-service";
import type {
	WorkerMessagePort,
	WorkerPoolRequestMessage,
	WorkerPoolResponseMessage,
} from "../../../../workers/pool";
import type { OpenWorldTextureBucketKey } from "../claims/bucket-key";
import type {
	OpenWorldTextureEntryId,
	OpenWorldTexturePageId,
	OpenWorldTexturePageReservationToken,
} from "../claims/texture-claim-registry";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";

export type OpenWorldTexturePageBuildFormat = "rgba8" | "r8" | "rg8";

export interface OpenWorldTexturePageBuildInput {
	/** Caller-owned job id used for diagnostics, not lifecycle currentness. */
	readonly jobId: string;
	/** Bucket lane that owns this page build. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Virtual page being built. */
	readonly pageId: OpenWorldTexturePageId;
	/** Reservation token minted by replacement page state before worker dispatch. */
	readonly reservationToken: OpenWorldTexturePageReservationToken;
	/** Physical upload and sampler facts required by the renderer adapter. */
	readonly page: OpenWorldTexturePageBuildPage;
	/** Entries to materialize into this page. Empty input is a valid noop. */
	readonly entries: readonly OpenWorldTexturePageBuildEntry[];
}

interface OpenWorldTexturePageBuildPage {
	/** Anisotropy value for renderer sampler policy. */
	readonly anisotropy: number;
	/** Runtime texture filtering policy. */
	readonly filteringMode: TextureFilteringMode;
	/** Physical page pixel format. */
	readonly format: OpenWorldTexturePageBuildFormat;
	/** Runtime page height in pixels. */
	readonly height: number;
	/** Whether the renderer should generate mipmaps for this page. */
	readonly mipmapsGenerated: boolean;
	/** Renderer-facing sample class for shader interpretation. */
	readonly sampleClass: TexturePageSampleClass;
	/** Stable sampler policy key for renderer sampler caching. */
	readonly samplerPolicyKey: string;
	/** Runtime page width in pixels. */
	readonly width: number;
	/** Horizontal wrap mode. */
	readonly wrapS: TextureWrapMode;
	/** Vertical wrap mode. */
	readonly wrapT: TextureWrapMode;
}

interface OpenWorldTexturePageBuildEntry {
	/** Shared logical texture entry being placed on this page. */
	readonly entryId: OpenWorldTextureEntryId;
	/** Material bindings that resolve to this entry once the page is accepted. */
	readonly bindingIds: readonly TextureBindingId[];
	/** Source identity prepared inside the page-build worker. */
	readonly dataUse: MaterialTextureDataUseIdentity;
	/** Gutter edge behavior used while expanding source pixels into the page. */
	readonly gutterEdgeMode: "clamp" | "repeat";
	/** Gutter width in pixels reserved around this source. */
	readonly gutterPixels: number;
	/** Content rect inside the virtual page, excluding gutter pixels. */
	readonly rect: readonly [number, number, number, number];
}

export type OpenWorldTexturePageBuildOutput =
	OpenWorldTexturePageUpdateOutput | OpenWorldTexturePageNoopOutput;

interface OpenWorldTexturePageUpdateOutput extends OpenWorldTexturePageBuildBaseOutput {
	/** Accepted page pixels and placement rects. */
	readonly kind: "page-update";
	/** Pixel payload for the complete page upload. */
	readonly page: OpenWorldTexturePageBuildPixelPage;
	/** Binding rects resolved by this page build. */
	readonly placements: readonly OpenWorldTexturePageBuildPlacement[];
}

interface OpenWorldTexturePageNoopOutput extends OpenWorldTexturePageBuildBaseOutput {
	/** The build found no page mutation to publish. */
	readonly kind: "noop";
	/** Human-readable reason for diagnostics. */
	readonly reason: string;
}

interface OpenWorldTexturePageBuildBaseOutput {
	/** Bucket lane that owns this result. */
	readonly bucketKey: OpenWorldTextureBucketKey;
	/** Worker job id echoed for diagnostics. */
	readonly jobId: string;
	/** Virtual page this result targets. */
	readonly pageId: OpenWorldTexturePageId;
	/** Reservation token that must still match replacement state. */
	readonly reservationToken: OpenWorldTexturePageReservationToken;
	/** Worker-owned page-build stage timings. */
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

interface OpenWorldTexturePageBuildPixelPage extends OpenWorldTexturePageBuildPage {
	/** Complete page pixels ready for renderer upload. */
	readonly pixels: Uint8Array;
	/** Renderer texture reference to update. */
	readonly textureRefId: string;
}

interface OpenWorldTexturePageBuildPlacement {
	/** Material-consumer binding resolved by this placement. */
	readonly bindingId: TextureBindingId;
	/** Rect inside the uploaded page. */
	readonly rect: readonly [number, number, number, number];
}

export type OpenWorldTexturePageBuildWorkerRequest = WorkerHandlerInputMessage<
	OpenWorldTexturePageBuildInput,
	PreparedAssetServiceResponse
>;

export type OpenWorldTexturePageBuildWorkerResponse =
	WorkerHandlerOutputMessage<
		OpenWorldTexturePageBuildOutput,
		never,
		PreparedAssetServiceRequest
	>;

export type OpenWorldTexturePageBuildWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<
		OpenWorldTexturePageBuildInput,
		PreparedAssetServiceResponse
	>,
	WorkerPoolResponseMessage<
		OpenWorldTexturePageBuildOutput,
		never,
		PreparedAssetServiceRequest
	>
>;

export type OpenWorldTexturePageBuildWorkerGlobalPort = WorkerHandlerPort<
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	never,
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse
>;
