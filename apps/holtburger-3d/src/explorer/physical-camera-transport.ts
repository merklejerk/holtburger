import type { HostPhysicalCameraSegment } from "../lib/game/motion/host-physical-camera-path";
import type { PhysicalCameraTransport } from "./physical-camera-session";

/** Production Tauri transport, isolated so session behavior remains browser-testable. */
export function tauriPhysicalCameraTransport(): PhysicalCameraTransport {
	return {
		invoke: async (command, args) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return invoke(command, args);
		},
		listen: async (event, handler) => {
			const { listen } = await import("@tauri-apps/api/event");
			return listen<HostPhysicalCameraSegment>(event, ({ payload }) =>
				handler(payload),
			);
		},
		now: () => performance.now(),
	};
}
