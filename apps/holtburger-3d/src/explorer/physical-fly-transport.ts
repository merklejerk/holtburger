import type { PhysicalFlyTransport } from "./physical-fly-session";
import type { HostTransport } from "../lib/host/host-transport";

/** Host-backed transport, isolated so session behavior remains browser-testable. */
export function hostPhysicalFlyTransport(
	host: HostTransport,
): PhysicalFlyTransport {
	return {
		invoke: (command, args) => host.invoke(command, args),
		listenMotion: (event, handler) => host.listen(event, handler),
		listenFailure: (event, handler) => host.listen(event, handler),
		now: () => performance.now(),
	};
}
