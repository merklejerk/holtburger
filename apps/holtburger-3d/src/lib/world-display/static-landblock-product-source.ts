import type {
	DesiredLandblockRenderProduct,
	LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import {
	StaticLandblockRenderArtifactStore,
	type StaticLandblockProductKey,
	type StaticLandblockRenderProductSet,
} from "./static-landblock-render-artifact-store";

export type StaticLandblockProductSourceEvent =
	| {
			type: "product-committed";
			result: LandblockRenderProductWorkerResult;
	  }
	| {
			type: "product-evicted";
			key: StaticLandblockProductKey;
	  }
	| {
			type: "products-cleared";
	  };

export type StaticLandblockProductSourceListener = (
	event: StaticLandblockProductSourceEvent,
) => void;

export interface StaticLandblockProductSource {
	getProductSet(): StaticLandblockRenderProductSet;
	subscribe(
		listener: StaticLandblockProductSourceListener,
	): StaticLandblockProductSourceSubscription;
}

export interface StaticLandblockProductSourceSubscription {
	unsubscribe(): void;
}

export class MutableStaticLandblockProductSource implements StaticLandblockProductSource {
	private readonly store: StaticLandblockRenderArtifactStore;
	private readonly listeners = new Set<StaticLandblockProductSourceListener>();

	constructor(store = new StaticLandblockRenderArtifactStore()) {
		this.store = store;
	}

	getProductSet(): StaticLandblockRenderProductSet {
		return this.store.productSet();
	}

	subscribe(
		listener: StaticLandblockProductSourceListener,
	): StaticLandblockProductSourceSubscription {
		this.listeners.add(listener);
		return {
			unsubscribe: () => {
				this.listeners.delete(listener);
			},
		};
	}

	syncDesiredProducts(
		desiredProducts: readonly DesiredLandblockRenderProduct[],
	): StaticLandblockProductKey[] {
		const evictedProductKeys = this.store.syncDesiredProducts(desiredProducts);
		for (const key of evictedProductKeys) {
			this.emit({ type: "product-evicted", key });
		}
		return evictedProductKeys;
	}

	clearProducts(): StaticLandblockProductKey[] {
		const evictedProductKeys = this.store.syncDesiredProducts([]);
		if (evictedProductKeys.length > 0) {
			this.emit({ type: "products-cleared" });
		}
		return evictedProductKeys;
	}

	markInFlight(desired: DesiredLandblockRenderProduct): boolean {
		return this.store.markInFlight(desired);
	}

	commitResult(result: LandblockRenderProductWorkerResult): boolean {
		const committed = this.store.commitResult(result);
		if (committed) {
			this.emit({ type: "product-committed", result });
		}
		return committed;
	}

	markError(desired: DesiredLandblockRenderProduct): void {
		this.store.markError(desired);
	}

	hasCurrentArtifact(desired: DesiredLandblockRenderProduct): boolean {
		return this.store.hasCurrentArtifact(desired);
	}

	private emit(event: StaticLandblockProductSourceEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}
