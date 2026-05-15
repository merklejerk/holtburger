import { describe, expect, it } from "vitest";

import {
	applyLoadedSnapshot,
	applyRuntimeNotification,
	createHostConnectionState,
} from "./host-state";
import {
	createHostSnapshot,
	createRuntimeBatch,
	createViewModelFeed,
} from "./test-fixtures";

describe("host state reducer", () => {
	it("loads host snapshots and derives boundary status", () => {
		const state = applyLoadedSnapshot(
			createHostConnectionState(),
			createHostSnapshot(),
		);

		expect(state.boundarySnapshot?.source).toBe("tauri");
		expect(state.boundaryStatus).toContain("Connected to the Tauri host");
	});

	it("merges runtime notifications into the latest boundary snapshot", () => {
		const notification = {
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState: null,
			runtimeBatch: createRuntimeBatch({ tick: 2 }),
			viewModelFeed: createViewModelFeed({ busyState: "loading" }),
		};
		const state = applyRuntimeNotification(
			applyLoadedSnapshot(createHostConnectionState(), createHostSnapshot()),
			notification,
		);

		expect(state.boundarySnapshot?.runtimeBatch.tick).toBe(2);
		expect(state.boundarySnapshot?.viewModelFeed.busyState).toBe("loading");
		expect(state.latestRuntimeNotification?.topic).toBe("runtime.batch");
	});
});
