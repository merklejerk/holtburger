import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriSimulationInterestTransport } from "./simulation-interest-transport";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
}));

describe("tauriSimulationInterestTransport", () => {
	beforeEach(() => {
		mocks.invoke.mockReset();
	});

	it("opens one host lifetime and injects it into every replacement", async () => {
		mocks.invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "start_simulation_interest_session") return 41;
				if (command !== "replace_simulation_interest") {
					throw new Error(`Unexpected command ${command}.`);
				}
				const request = args?.request as {
					readonly revision: number;
				};
				return {
					committed: true,
					revision: request.revision,
					unavailableLandblockIds: [],
				};
			},
		);
		const transport = tauriSimulationInterestTransport();

		await transport.replace({
			landblockIds: ["0xda55ffff"],
			revision: 1,
		});
		await transport.replace({
			landblockIds: ["0xdb55ffff"],
			revision: 2,
		});

		expect(mocks.invoke).toHaveBeenCalledTimes(3);
		expect(mocks.invoke).toHaveBeenNthCalledWith(
			2,
			"replace_simulation_interest",
			{
				request: {
					landblockIds: ["0xda55ffff"],
					revision: 1,
					session: 41,
				},
			},
		);
		expect(mocks.invoke).toHaveBeenNthCalledWith(
			3,
			"replace_simulation_interest",
			{
				request: {
					landblockIds: ["0xdb55ffff"],
					revision: 2,
					session: 41,
				},
			},
		);
	});
});
