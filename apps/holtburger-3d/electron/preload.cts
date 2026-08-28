import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

type HostListener = (payload: unknown) => void;

interface RegisteredHostListener {
	readonly event: string;
	readonly handler: HostListener;
}

const listeners = new Map<number, RegisteredHostListener>();
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

ipcRenderer.on("host:event", (_ipcEvent, payload: unknown) => {
	if (!isEventEnvelope(payload))
		throw new Error("malformed host event envelope");
	for (const listener of listeners.values()) {
		if (listener.event === payload.event) listener.handler(payload.payload);
	}
});

contextBridge.exposeInMainWorld("holtburgerHost", {
	invoke(
		command: string,
		args?: Readonly<Record<string, unknown>>,
	): Promise<unknown> {
		return ipcRenderer.invoke("host:invoke", { command, args });
	},
	listen(event: string, handler: HostListener): Promise<number> {
		const token = nextListenerToken++;
		listeners.set(token, { event, handler });
		return Promise.resolve(token);
	},
	unlisten(token: number): Promise<void> {
		listeners.delete(token);
		return Promise.resolve();
	},
});
