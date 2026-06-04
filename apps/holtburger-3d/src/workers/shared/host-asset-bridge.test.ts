import { describe, expect, it } from "vitest";

import type { AssetLookupRequestDto } from "../../lib/host/contracts";
import { encodeJsonAssetBatchEnvelope } from "../../lib/host/binary-asset-envelope";
import type { WorkerHostLookupBinaryRequestMessage } from "./host-asset-bridge";
import { WorkerHostAssetBridge } from "./host-asset-bridge";

describe("worker host asset bridge", () => {
	it("posts host lookup requests and decodes completed binary envelopes", async () => {
		const scope = new FakeBridgeScope();
		const bridge = new WorkerHostAssetBridge(scope, {
			requestIdPrefix: "test-host",
			profileLabelPrefix: "test-worker",
		});
		const request = createRequest("request-a", "palette/04000001");

		const lookup = bridge.lookupBinaryAssets([request]);
		expect(scope.messages).toEqual([
			{
				type: "host-lookup-assets-binary",
				requestId: "test-host-1",
				requests: [request],
			},
		]);

		bridge.resolve({
			type: "host-lookup-assets-binary-complete",
			requestId: "test-host-1",
			envelopes: [
				{
					payload: encodeJsonAssetBatchEnvelope([
						{
							requestId: request.requestId,
							assetId: request.assetId,
							payloadKind: "json",
							payload: { kind: "visual-asset-stub" },
						},
					]),
				},
			],
		});

		await expect(lookup).resolves.toMatchObject({
			responses: [
				{
					requestId: request.requestId,
					assetId: request.assetId,
					payload: { kind: "visual-asset-stub" },
				},
			],
		});
	});

	it("rejects pending lookups from host error messages", async () => {
		const scope = new FakeBridgeScope();
		const bridge = new WorkerHostAssetBridge(scope, {
			requestIdPrefix: "test-host",
			profileLabelPrefix: "test-worker",
		});

		const lookup = bridge.lookupBinaryAssets([
			createRequest("request-a", "palette/04000001"),
		]);
		bridge.reject({
			type: "host-lookup-assets-binary-error",
			requestId: "test-host-1",
			message: "backend unavailable",
		});

		await expect(lookup).rejects.toThrow("backend unavailable");
	});
});

class FakeBridgeScope {
	readonly messages: WorkerHostLookupBinaryRequestMessage[] = [];

	postMessage(message: WorkerHostLookupBinaryRequestMessage): void {
		this.messages.push(message);
	}
}

function createRequest(
	requestId: string,
	assetId: string,
): AssetLookupRequestDto {
	return {
		requestId,
		assetId,
		priority: "streaming",
	};
}
