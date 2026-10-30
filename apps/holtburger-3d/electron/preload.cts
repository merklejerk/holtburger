import electron = require("electron");
import type { PointerPosition } from "./pointer-lock-hover.js";

const { contextBridge, ipcRenderer } = electron;

// Each preload instance belongs to one document, even when BrowserWindow is reused.
const documentIdentity: Promise<string> = ipcRenderer.invoke("document:boot");
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
	return ipcRenderer.invoke(channel, await documentIdentity, ...args);
}

if (process.argv.includes("--holtburger-wayland-pointer-restore")) {
	let position: PointerPosition | null = null;
	let lockOrigin: PointerPosition | null = null;
	const observePosition = (event: MouseEvent): void => {
		if (globalThis.document.pointerLockElement !== null) return;
		position = {
			x: event.clientX,
			y: event.clientY,
			globalX: event.screenX,
			globalY: event.screenY,
		};
	};
	globalThis.addEventListener("mousemove", observePosition, true);
	globalThis.addEventListener("mousedown", observePosition, true);
	globalThis.addEventListener("blur", () => {
		position = null;
		lockOrigin = null;
	});
	globalThis.document.addEventListener("pointerlockchange", () => {
		if (globalThis.document.pointerLockElement !== null) {
			lockOrigin = position;
			return;
		}
		const origin = lockOrigin;
		lockOrigin = null;
		// Correct hover immediately; an animation-frame delay makes the displaced hover flash longer.
		if (origin !== null && globalThis.document.hasFocus())
			void invoke("window:restore-pointer", origin).catch(console.error);
	});
}

contextBridge.exposeInMainWorld("holtburgerLauncher", {
	enabled: !process.argv.includes("--holtburger-launcher-disabled"),
	snapshot: () => invoke("launcher:snapshot"),
	directory: (refresh: boolean) => invoke("launcher:directory", refresh),
	importServer: (key: string) => invoke("launcher:import-server", key),
	saveServer: (value: unknown) => invoke("launcher:save-server", value),
	deleteServer: (id: string) => invoke("launcher:delete-server", id),
	saveProfile: (value: unknown) => invoke("launcher:save-profile", value),
	deleteProfile: (id: string) => invoke("launcher:delete-profile", id),
	credentials: (selection: unknown) =>
		invoke("launcher:credentials", selection),
	recover: () => invoke("launcher:recover"),
	play: (value: unknown) => invoke("launcher:play", value),
	back: (diagnostic: string | null) => invoke("launcher:back", diagnostic),
});

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
		return invoke("host:invoke", { command, args });
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
		return invoke("content:snapshot");
	},
	choose(): Promise<void> {
		return invoke("content:choose");
	},
	retry(): Promise<void> {
		return invoke("content:retry");
	},
	quit(): Promise<void> {
		return invoke("content:quit");
	},
	listen(handler: (snapshot: unknown) => void): () => void {
		const listener = (_event: unknown, snapshot: unknown) => handler(snapshot);
		ipcRenderer.on("content:state", listener);
		return () => ipcRenderer.removeListener("content:state", listener);
	},
});

contextBridge.exposeInMainWorld("holtburgerThemes", {
	list(): Promise<unknown> {
		return invoke("themes:list");
	},
	resolve(id: string): Promise<unknown> {
		return invoke("themes:resolve", id);
	},
	openDirectory(): Promise<void> {
		return invoke("themes:open-directory");
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
				(result) => invoke("client:prepared-close", result),
				(error) =>
					invoke("client:prepared-close", {
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
			return invoke("client:request-close");
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
			return invoke("client:start");
		},
	});
	contextBridge.exposeInMainWorld("holtburgerVisualCache", {
		read(guid: number): Promise<unknown> {
			return invoke("visual-cache:read", guid);
		},
		stage(capture: unknown): Promise<void> {
			return invoke("visual-cache:stage", capture);
		},
		listenFailures(handler: (message: unknown) => void): () => void {
			const listener = (_event: unknown, message: unknown) => handler(message);
			ipcRenderer.on("visual-cache:failure", listener);
			return () => ipcRenderer.removeListener("visual-cache:failure", listener);
		},
	});
	contextBridge.exposeInMainWorld("holtburgerSettings", {
		loadUser(defaults: unknown): Promise<unknown> {
			return invoke("settings:load-user", defaults);
		},
		saveUserPatch(patch: unknown): Promise<void> {
			return invoke("settings:save-user-patch", patch);
		},
		resetUser(settings: unknown): Promise<unknown> {
			return invoke("settings:reset-user", settings);
		},
		loadCharacter(characterGuid: number, defaults: unknown): Promise<unknown> {
			return invoke("settings:load-character", characterGuid, defaults);
		},
		saveCharacterPatch(characterGuid: number, patch: unknown): Promise<void> {
			return invoke("settings:save-character-patch", {
				characterGuid,
				patch,
			});
		},
	});
}
