import type { HostPhysicalFlyPath } from "../lib/game/motion/host-physical-fly-path";
import type {
	HostPhysicalFlyFailure,
	PhysicalFlyTransport,
} from "./physical-fly-session";

/** Production Tauri transport, isolated so session behavior remains browser-testable. */
export function tauriPhysicalFlyTransport(): PhysicalFlyTransport {
	return {
		invoke: async (command, args) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return invoke(command, args);
		},
		listenMotion: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<HostPhysicalFlyPath>(event, ({ payload }) =>
				handler(payload),
			);
		},
		listenFailure: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<HostPhysicalFlyFailure>(event, ({ payload }) =>
				handler(payload),
			);
		},
		now: () => performance.now(),
	};
}
