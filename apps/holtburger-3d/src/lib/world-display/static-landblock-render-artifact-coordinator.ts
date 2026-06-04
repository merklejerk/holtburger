import {
	describeBrowserDestinationIdentity,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import { planDesiredLandblockRenderPresets } from "../assets/landblock-render-preset-planner";
import {
	StaticLandblockRenderArtifactStore,
	type StaticLandblockRenderArtifactStoreSnapshot,
} from "./static-landblock-render-artifact-store";
import {
	StaticLandblockRenderWorkerClient,
} from "./static-landblock-render-worker-client";
import type {
	DesiredLandblockRenderPreset,
	LandblockRenderPresetBuildPolicy,
	LandblockRenderPresetWorkerResult,
} from "./landblock-render-preset";

const STATIC_LANDBLOCK_RENDER_BUILD_POLICY_REVISION =
	"static-landblock-render:v1";
const STATIC_LANDBLOCK_RENDER_TEXTURE_PAGE_POLICY_REVISION =
	"static-landblock-texture-pages:v1";

const DEFAULT_STATIC_LANDBLOCK_RENDER_BUILD_POLICY: LandblockRenderPresetBuildPolicy =
	{
		atlasLayout: {
			maxTextureSize: 4096,
			maxTextureCount: 8,
			gutterPixels: 2,
		},
		terrainMaxLayerEntries: 8,
	};

export interface StaticLandblockRenderArtifactCoordinatorInput {
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	envCellLodRadius: number;
}

interface StaticLandblockRenderPresetClient {
	requestPreset(
		desired: DesiredLandblockRenderPreset,
	): Promise<LandblockRenderPresetWorkerResult>;
	dispose(): void;
}

interface StaticLandblockRenderArtifactCoordinatorOptions {
	client?: StaticLandblockRenderPresetClient;
	store?: StaticLandblockRenderArtifactStore;
	buildPolicy?: LandblockRenderPresetBuildPolicy;
	buildPolicyRevision?: string;
	texturePagePolicyRevision?: string;
	onStoreChanged?: (
		snapshot: StaticLandblockRenderArtifactStoreSnapshot,
	) => void;
	onError?: (error: Error, desired: DesiredLandblockRenderPreset) => void;
}

export class StaticLandblockRenderArtifactCoordinator {
	private readonly client: StaticLandblockRenderPresetClient;
	private readonly store: StaticLandblockRenderArtifactStore;
	private readonly buildPolicy: LandblockRenderPresetBuildPolicy;
	private readonly buildPolicyRevision: string;
	private readonly texturePagePolicyRevision: string;
	private readonly onStoreChanged:
		| ((snapshot: StaticLandblockRenderArtifactStoreSnapshot) => void)
		| undefined;
	private readonly onError:
		| ((error: Error, desired: DesiredLandblockRenderPreset) => void)
		| undefined;
	private nextRequestSequence = 1;
	private lastInputSignature: string | null = null;
	private lastRequestId: string | null = null;
	private disposed = false;

	constructor(options: StaticLandblockRenderArtifactCoordinatorOptions = {}) {
		this.client = options.client ?? new StaticLandblockRenderWorkerClient();
		this.store = options.store ?? new StaticLandblockRenderArtifactStore();
		this.buildPolicy =
			options.buildPolicy ?? DEFAULT_STATIC_LANDBLOCK_RENDER_BUILD_POLICY;
		this.buildPolicyRevision =
			options.buildPolicyRevision ??
			STATIC_LANDBLOCK_RENDER_BUILD_POLICY_REVISION;
		this.texturePagePolicyRevision =
			options.texturePagePolicyRevision ??
			STATIC_LANDBLOCK_RENDER_TEXTURE_PAGE_POLICY_REVISION;
		this.onStoreChanged = options.onStoreChanged;
		this.onError = options.onError;
	}

	sync(input: StaticLandblockRenderArtifactCoordinatorInput): void {
		if (this.disposed) {
			return;
		}
		const requestId = this.resolveRequestId(input);
		const desiredPresets = planDesiredLandblockRenderPresets({
			browserDestination: input.browserDestination,
			requestId,
			buildPolicyRevision: this.buildPolicyRevision,
			texturePagePolicyRevision: this.texturePagePolicyRevision,
			buildPolicy: this.buildPolicy,
			options: {
				terrainRadius: input.terrainLodRadius,
				buildingRadius: input.buildingLodRadius,
				detailRadius: input.detailLodRadius,
				envCellRadius: input.envCellLodRadius,
			},
		});

		this.store.syncDesiredPresets(desiredPresets);
		for (const desired of desiredPresets) {
			if (this.store.hasCurrentArtifact(desired)) {
				continue;
			}
			if (!this.store.markInFlight(desired)) {
				continue;
			}
			void this.client
				.requestPreset(desired)
				.then((result) => {
					if (this.disposed) {
						return;
					}
					if (this.store.commitResult(result)) {
						this.onStoreChanged?.(this.store.snapshot());
					}
				})
				.catch((error) => {
					const normalized = toError(error);
					this.store.markError(desired);
					this.onError?.(normalized, desired);
					this.onStoreChanged?.(this.store.snapshot());
				});
		}
	}

	getSnapshot(): StaticLandblockRenderArtifactStoreSnapshot {
		return this.store.snapshot();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.client.dispose();
	}

	private resolveRequestId(
		input: StaticLandblockRenderArtifactCoordinatorInput,
	): string {
		const signature = describeCoordinatorInputSignature(input);
		if (this.lastInputSignature === signature && this.lastRequestId !== null) {
			return this.lastRequestId;
		}
		this.lastInputSignature = signature;
		this.lastRequestId = `static-landblock-render:${this.nextRequestSequence++}`;
		return this.lastRequestId;
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function describeCoordinatorInputSignature(
	input: StaticLandblockRenderArtifactCoordinatorInput,
): string {
	const destinationKey =
		describeBrowserDestinationIdentity(input.browserDestination) ?? "none";
	return [
		destinationKey,
		input.terrainLodRadius,
		input.buildingLodRadius,
		input.detailLodRadius,
		input.envCellLodRadius,
	].join("|");
}
