import {
	describeBrowserDestinationIdentity,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import { planDesiredLandblockRenderProducts } from "../assets/landblock-render-product-planner";
import {
	StaticLandblockRenderArtifactStore,
	type StaticLandblockProductKey,
	type StaticLandblockRenderProductSet,
} from "./static-landblock-render-artifact-store";
import { StaticLandblockRenderWorkerClient } from "./static-landblock-render-worker-client";
import type {
	DesiredLandblockRenderProduct,
	LandblockRenderProductBuildPolicy,
	LandblockRenderProductWorkerResult,
} from "./landblock-render-product";

const STATIC_LANDBLOCK_RENDER_BUILD_POLICY_REVISION =
	"static-landblock-render:v1";
const STATIC_LANDBLOCK_RENDER_TEXTURE_PAGE_POLICY_REVISION =
	"static-landblock-texture-pages:v1";

const DEFAULT_STATIC_LANDBLOCK_RENDER_BUILD_POLICY: LandblockRenderProductBuildPolicy =
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

interface StaticLandblockRenderProductClient {
	requestProduct(
		desired: DesiredLandblockRenderProduct,
	): Promise<LandblockRenderProductWorkerResult>;
	dispose(): void;
}

interface StaticLandblockRenderArtifactCoordinatorOptions {
	client?: StaticLandblockRenderProductClient;
	store?: StaticLandblockRenderArtifactStore;
	buildPolicy?: LandblockRenderProductBuildPolicy;
	buildPolicyRevision?: string;
	texturePagePolicyRevision?: string;
	onStoreChanged?: (
		productSet: StaticLandblockRenderProductSet,
	) => void;
	onProductCommitted?: (result: LandblockRenderProductWorkerResult) => void;
	onProductEvicted?: (key: StaticLandblockProductKey) => void;
	onProductsCleared?: () => void;
	onError?: (error: Error, desired: DesiredLandblockRenderProduct) => void;
}

export class StaticLandblockRenderArtifactCoordinator {
	private readonly client: StaticLandblockRenderProductClient;
	private readonly store: StaticLandblockRenderArtifactStore;
	private readonly buildPolicy: LandblockRenderProductBuildPolicy;
	private readonly buildPolicyRevision: string;
	private readonly texturePagePolicyRevision: string;
	private readonly onStoreChanged:
		| ((productSet: StaticLandblockRenderProductSet) => void)
		| undefined;
	private readonly onProductCommitted:
		| ((result: LandblockRenderProductWorkerResult) => void)
		| undefined;
	private readonly onProductEvicted:
		| ((key: StaticLandblockProductKey) => void)
		| undefined;
	private readonly onProductsCleared: (() => void) | undefined;
	private readonly onError:
		| ((error: Error, desired: DesiredLandblockRenderProduct) => void)
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
		this.onProductCommitted = options.onProductCommitted;
		this.onProductEvicted = options.onProductEvicted;
		this.onProductsCleared = options.onProductsCleared;
		this.onError = options.onError;
	}

	sync(input: StaticLandblockRenderArtifactCoordinatorInput): void {
		if (this.disposed) {
			return;
		}
		const requestId = this.resolveRequestId(input);
		const desiredProducts = planDesiredLandblockRenderProducts({
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

		const evictedProductKeys = this.store.syncDesiredProducts(desiredProducts);
		if (
			desiredProducts.length === 0 &&
			evictedProductKeys.length > 0 &&
			this.onProductsCleared
		) {
			this.onProductsCleared?.();
		} else {
			for (const key of evictedProductKeys) {
				this.onProductEvicted?.(key);
			}
		}
		for (const desired of desiredProducts) {
			if (this.store.hasCurrentArtifact(desired)) {
				continue;
			}
			if (!this.store.markInFlight(desired)) {
				continue;
			}
			void this.client
				.requestProduct(desired)
				.then((result) => {
					if (this.disposed) {
						return;
					}
					const committed = this.store.commitResult(result);
					if (committed) {
						this.onProductCommitted?.(result);
						this.onStoreChanged?.(this.store.productSet());
					}
				})
				.catch((error) => {
					const normalized = toError(error);
					this.store.markError(desired);
					this.onError?.(normalized, desired);
					this.onStoreChanged?.(this.store.productSet());
				});
		}
	}

	getProductSet(): StaticLandblockRenderProductSet {
		return this.store.productSet();
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
