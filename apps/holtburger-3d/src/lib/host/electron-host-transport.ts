import type { ClientClosePreparation } from "../../client/client-close-contract";
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
		/** Credential-free, explicit startup capability available only in client mode. */
		holtburgerClient?: {
			start(): Promise<void>;
			/** Product Quit requests native preparation without destroying the renderer first. */
			quit(): Promise<void>;
			/** Native close remains intercepted until this renderer preparation acknowledges its work. */
			onPrepareClose(
				handler: () => Promise<ClientClosePreparation>,
			): () => void;
		};
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

/** Launch the configured native client after its event listeners have been installed. */
export async function startElectronClient(): Promise<void> {
	const bridge = globalThis.window?.holtburgerClient;
	if (bridge === undefined)
		throw new Error("Electron client startup bridge is unavailable");
	await bridge.start();
}

/** Register before normal interaction; preload buffers a native request arriving before this call. */
export function registerElectronClientClose(
	handler: () => Promise<ClientClosePreparation>,
): () => void {
	const bridge = globalThis.window?.holtburgerClient;
	if (bridge === undefined)
		throw new Error("Electron client close bridge is unavailable");
	return bridge.onPrepareClose(handler);
}

/** Product Quit is explicit; renderer window.close can destroy contents before native interception. */
export async function requestElectronClientClose(): Promise<void> {
	const bridge = globalThis.window?.holtburgerClient;
	if (bridge === undefined)
		throw new Error("Electron client close bridge is unavailable");
	await bridge.quit();
}
