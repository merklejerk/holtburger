import {
	decodeSimulationInterestReceipt,
	type SimulationInterestRequest,
	type SimulationInterestTransport,
} from "./simulation-interest";
import type { HostTransport } from "../lib/host/host-transport";

interface HostSimulationInterestRequest extends SimulationInterestRequest {
	/** Host-issued frontend lifetime; retired webviews cannot supersede this request. */
	readonly session: number;
}

/** Host-backed adapter for explicit collision simulation interest. */
export function hostSimulationInterestTransport(
	host: HostTransport,
): SimulationInterestTransport {
	const session = host
		.invoke("start_simulation_interest_session")
		.then(decodeSimulationInterestSession);
	return {
		async replace(request: SimulationInterestRequest) {
			const hostRequest: HostSimulationInterestRequest = {
				...request,
				session: await session,
			};
			return decodeSimulationInterestReceipt(
				await host.invoke("replace_simulation_interest", {
					request: hostRequest,
				}),
			);
		},
	};
}

function decodeSimulationInterestSession(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error("Host returned an invalid simulation-interest session.");
	}
	return value;
}
