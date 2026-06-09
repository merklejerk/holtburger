import { describe, expect, it } from "vitest";

import type {
	DesiredLandblockRenderProduct,
	LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import {
	MutableStaticLandblockProductSource,
	type StaticLandblockProductSourceEvent,
} from "./static-landblock-product-source";

describe("static landblock product source", () => {
	it("emits one commit event per committed current result", () => {
		const source = new MutableStaticLandblockProductSource();
		const events = captureEvents(source);
		const desired = createDesired({
			requestId: "request:one",
			product: "outdoor-terrain",
		});

		source.syncDesiredProducts([desired]);
		source.markInFlight(desired);
		expect(source.commitResult(createResult(desired))).toBe(true);

		expect(events.map((event) => event.type)).toEqual(["product-committed"]);
		expect(source.getProductSet()).toMatchObject({
			residentCount: 1,
			committedResultCount: 1,
		});
	});

	it("does not emit commit events for stale results", () => {
		const source = new MutableStaticLandblockProductSource();
		const events = captureEvents(source);
		const oldDesired = createDesired({
			requestId: "request:old",
			product: "outdoor-terrain",
		});
		const newDesired = createDesired({
			requestId: "request:new",
			product: "outdoor-terrain",
		});

		source.syncDesiredProducts([oldDesired]);
		source.markInFlight(oldDesired);
		source.syncDesiredProducts([newDesired]);
		source.markInFlight(newDesired);

		expect(source.commitResult(createResult(oldDesired))).toBe(false);
		expect(source.commitResult(createResult(newDesired))).toBe(true);

		expect(events.map((event) => event.type)).toEqual(["product-committed"]);
		expect(source.getProductSet().staleResultCount).toBe(1);
	});

	it("emits evict events when desired products leave residency", () => {
		const source = new MutableStaticLandblockProductSource();
		const events = captureEvents(source);
		const terrain = createDesired({
			requestId: "request:terrain",
			product: "outdoor-terrain",
		});
		const buildings = createDesired({
			requestId: "request:buildings",
			product: "outdoor-buildings",
		});

		source.syncDesiredProducts([terrain, buildings]);
		source.markInFlight(terrain);
		source.markInFlight(buildings);
		source.commitResult(createResult(terrain));
		source.commitResult(createResult(buildings));
		source.syncDesiredProducts([terrain]);

		expect(events.map((event) => event.type)).toEqual([
			"product-committed",
			"product-committed",
			"product-evicted",
		]);
		expect(events[2]).toMatchObject({
			type: "product-evicted",
			key: {
				landblockId: 0xda55ffff,
				product: "outdoor-buildings",
			},
		});
	});

	it("emits one clear event for an explicit resident product clear", () => {
		const source = new MutableStaticLandblockProductSource();
		const events = captureEvents(source);
		const terrain = createDesired({
			requestId: "request:terrain",
			product: "outdoor-terrain",
		});
		const buildings = createDesired({
			requestId: "request:buildings",
			product: "outdoor-buildings",
		});

		source.syncDesiredProducts([terrain, buildings]);
		source.markInFlight(terrain);
		source.markInFlight(buildings);
		source.commitResult(createResult(terrain));
		source.commitResult(createResult(buildings));
		source.clearProducts();

		expect(events.map((event) => event.type)).toEqual([
			"product-committed",
			"product-committed",
			"products-cleared",
		]);
		expect(source.getProductSet().residentCount).toBe(0);
	});

	it("exposes current products to late consumers and supports unsubscribe", () => {
		const source = new MutableStaticLandblockProductSource();
		const firstDesired = createDesired({
			requestId: "request:first",
			product: "outdoor-terrain",
		});
		source.syncDesiredProducts([firstDesired]);
		source.markInFlight(firstDesired);
		source.commitResult(createResult(firstDesired));

		const lateEvents = captureEvents(source);
		expect(source.getProductSet()).toMatchObject({
			residentCount: 1,
			artifacts: [{ requestId: "request:first" }],
		});
		lateEvents.subscription.unsubscribe();

		const secondDesired = createDesired({
			requestId: "request:second",
			product: "outdoor-buildings",
		});
		source.syncDesiredProducts([firstDesired, secondDesired]);
		source.markInFlight(secondDesired);
		source.commitResult(createResult(secondDesired));

		expect(lateEvents).toHaveLength(0);
	});
});

function captureEvents(source: MutableStaticLandblockProductSource) {
	const events: StaticLandblockProductSourceEvent[] & {
		subscription?: { unsubscribe(): void };
	} = [];
	events.subscription = source.subscribe((event) => {
		events.push(event);
	});
	return events as StaticLandblockProductSourceEvent[] & {
		subscription: { unsubscribe(): void };
	};
}

function createDesired({
	requestId,
	product,
}: {
	requestId: string;
	product: DesiredLandblockRenderProduct["product"];
}): DesiredLandblockRenderProduct {
	return {
		landblockId: 0xda55ffff,
		product,
		priority: "resident-now",
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: {
			atlasLayout: {
				maxTextureSize: 64,
				maxTextureCount: 4,
				gutterPixels: 0,
			},
			terrainMaxLayerEntries: 8,
		},
	};
}

function createResult(
	desired: DesiredLandblockRenderProduct,
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: `job:${desired.requestId}`,
		landblockId: desired.landblockId,
		product: desired.product,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		artifacts: [],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}
