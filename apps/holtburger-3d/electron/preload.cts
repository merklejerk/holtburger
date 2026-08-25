import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

type HostListener = (payload: unknown) => void;

const listeners = new Map<
	number,
	(_event: Electron.IpcRendererEvent, payload: unknown) => void
>();
let nextListenerToken = 1;

function isEventEnvelope(
	value: unknown,
): value is { event: string; payload: unknown } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { event?: unknown }).event === "string" &&
		"payload" in value
	);
}

contextBridge.exposeInMainWorld("holtburgerHost", {
	invoke(
		command: string,
		args?: Readonly<Record<string, unknown>>,
	): Promise<unknown> {
		return ipcRenderer.invoke("host:invoke", { command, args });
	},
	listen(event: string, handler: HostListener): Promise<number> {
		const token = nextListenerToken++;
		const listener = (
			_ipcEvent: Electron.IpcRendererEvent,
			payload: unknown,
		) => {
			if (!isEventEnvelope(payload))
				throw new Error("malformed host event envelope");
			if (payload.event === event) handler(payload.payload);
		};
		listeners.set(token, listener);
		ipcRenderer.on("host:event", listener);
		return Promise.resolve(token);
	},
	unlisten(token: number): Promise<void> {
		const listener = listeners.get(token);
		if (listener) {
			ipcRenderer.removeListener("host:event", listener);
			listeners.delete(token);
		}
		return Promise.resolve();
	},
});
