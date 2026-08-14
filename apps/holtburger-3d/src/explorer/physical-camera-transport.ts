import type { HostPhysicalCameraPath } from "../lib/game/motion/host-physical-camera-path";
import type {
	HostPhysicalCameraFailure,
	PhysicalCameraTransport,
} from "./physical-camera-session";

/** Production Tauri transport, isolated so session behavior remains browser-testable. */
export function tauriPhysicalCameraTransport(): PhysicalCameraTransport {
	return {
		invoke: async (command, args) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return invoke(command, args);
		},
		listenMotion: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<HostPhysicalCameraPath>(event, ({ payload }) =>
				handler(payload),
			);
		},
		listenFailure: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<HostPhysicalCameraFailure>(event, ({ payload }) =>
				handler(payload),
			);
		},
		now: () => performance.now(),
	};
}
