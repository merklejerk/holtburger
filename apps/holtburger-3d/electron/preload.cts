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

contextBridge.exposeInMainWorld("holtburgerContent", {
	snapshot(): Promise<unknown> {
		return ipcRenderer.invoke("content:snapshot");
	},
	choose(): Promise<void> {
		return ipcRenderer.invoke("content:choose");
	},
	retry(): Promise<void> {
		return ipcRenderer.invoke("content:retry");
	},
	quit(): Promise<void> {
		return ipcRenderer.invoke("content:quit");
	},
	listen(handler: (snapshot: unknown) => void): () => void {
		const listener = (_event: unknown, snapshot: unknown) => handler(snapshot);
		ipcRenderer.on("content:state", listener);
		return () => ipcRenderer.removeListener("content:state", listener);
	},
});

contextBridge.exposeInMainWorld("holtburgerThemes", {
	list(): Promise<unknown> {
		return ipcRenderer.invoke("themes:list");
	},
	resolve(id: string): Promise<unknown> {
		return ipcRenderer.invoke("themes:resolve", id);
	},
	openDirectory(): Promise<void> {
		return ipcRenderer.invoke("themes:open-directory");
	},
});

if (process.argv.includes("--holtburger-mode=client")) {
	// Preload is ready before Svelte: retain an early native close request until the app registers.
	type PreparationHandler = () => Promise<unknown>;
	let preparation:
		| {
				kind: "waiting";
				requested: boolean;
				handler: PreparationHandler | null;
		  }
		| { kind: "running" } = {
		kind: "waiting",
		requested: false,
		handler: null,
	};
	const prepare = () => {
		if (preparation.kind === "running") return;
		preparation.requested = true;
		const handler = preparation.handler;
		if (handler === null) return;
		preparation = { kind: "running" };
		void Promise.resolve()
			.then(handler)
			.then(
				(result) => ipcRenderer.invoke("client:prepared-close", result),
				(error) =>
					ipcRenderer.invoke("client:prepared-close", {
						kind: "failed",
						diagnostic: error instanceof Error ? error.message : String(error),
					}),
			)
			.catch((error) =>
				console.error("Client close acknowledgement failed", error),
			);
	};
	ipcRenderer.on("client:prepare-close", prepare);

	contextBridge.exposeInMainWorld("holtburgerClient", {
		quit(): Promise<void> {
			return ipcRenderer.invoke("client:request-close");
		},
		onPrepareClose(handler: PreparationHandler): () => void {
			if (preparation.kind === "running" || preparation.handler !== null)
				throw new Error(
					"Client close preparation handler is already registered.",
				);
			preparation.handler = handler;
			if (preparation.requested) prepare();
			return () => {
				if (preparation.kind === "waiting" && preparation.handler === handler)
					preparation.handler = null;
			};
		},
		start(): Promise<void> {
			return ipcRenderer.invoke("client:start");
		},
	});
	contextBridge.exposeInMainWorld("holtburgerVisualCache", {
		read(guid: number): Promise<unknown> {
			return ipcRenderer.invoke("visual-cache:read", guid);
		},
		stage(capture: unknown): Promise<void> {
			return ipcRenderer.invoke("visual-cache:stage", capture);
		},
		listenFailures(handler: (message: unknown) => void): () => void {
			const listener = (_event: unknown, message: unknown) => handler(message);
			ipcRenderer.on("visual-cache:failure", listener);
			return () => ipcRenderer.removeListener("visual-cache:failure", listener);
		},
	});
	contextBridge.exposeInMainWorld("holtburgerSettings", {
		loadUser(defaults: unknown): Promise<unknown> {
			return ipcRenderer.invoke("settings:load-user", defaults);
		},
		saveUserPatch(patch: unknown): Promise<void> {
			return ipcRenderer.invoke("settings:save-user-patch", patch);
		},
		resetUser(settings: unknown): Promise<unknown> {
			return ipcRenderer.invoke("settings:reset-user", settings);
		},
		loadCharacter(characterGuid: number, defaults: unknown): Promise<unknown> {
			return ipcRenderer.invoke(
				"settings:load-character",
				characterGuid,
				defaults,
			);
		},
		saveCharacterPatch(characterGuid: number, patch: unknown): Promise<void> {
			return ipcRenderer.invoke("settings:save-character-patch", {
				characterGuid,
				patch,
			});
		},
	});
}
