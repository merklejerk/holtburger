import type {
	HostCommandArguments,
	HostCommandName,
	HostEventName,
	HostEventPayloadMap,
	HostTransport,
} from "./host-transport";

interface ElectronHostBridge {
	invoke(
		command: HostCommandName,
		args?: HostCommandArguments,
	): Promise<unknown>;
	listen(
		event: HostEventName,
		handler: (payload: unknown) => void,
	): Promise<number>;
	unlisten(token: number): Promise<void>;
}

declare global {
	interface Window {
		holtburgerHost?: ElectronHostBridge;
	}
}

function electronHostBridge(): ElectronHostBridge | undefined {
	return globalThis.window?.holtburgerHost;
}

/** Adapts the narrow renderer host boundary to Electron's context-isolated preload API. */
export function createElectronHostTransport(): HostTransport {
	const bridge = electronHostBridge();
	if (!bridge) throw new Error("Electron host bridge is unavailable");
	return {
		invoke(command, args) {
			return bridge.invoke(command, args);
		},
		listen<K extends HostEventName>(
			event: K,
			handler: (payload: HostEventPayloadMap[K]) => void,
		): Promise<() => void> {
			return bridge
				.listen(event, handler as (payload: unknown) => void)
				.then((token) => {
					return () => {
						void bridge.unlisten(token);
					};
				});
		},
	};
}
