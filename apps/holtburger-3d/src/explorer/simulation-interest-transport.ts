import { invoke } from "@tauri-apps/api/core";
import type {
	SimulationInterestReceipt,
	SimulationInterestRequest,
	SimulationInterestTransport,
} from "./simulation-interest";

interface HostSimulationInterestRequest extends SimulationInterestRequest {
	/** Host-issued frontend lifetime; retired webviews cannot supersede this request. */
	readonly session: number;
}

/** Production Tauri adapter for explicit collision simulation interest. */
export function tauriSimulationInterestTransport(): SimulationInterestTransport {
	const session = invoke<number>("start_simulation_interest_session");
	return {
		async replace(request: SimulationInterestRequest) {
			const hostRequest: HostSimulationInterestRequest = {
				...request,
				session: await session,
			};
			return invoke<SimulationInterestReceipt>("replace_simulation_interest", {
				request: hostRequest,
			});
		},
	};
}
