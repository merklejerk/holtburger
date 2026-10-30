import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { ClientClosePreparation } from "../src/client/client-close-contract";

interface ClientBridge {
	quit(): Promise<void>;
	onPrepareClose(handler: () => Promise<ClientClosePreparation>): () => void;
}
function setup() {
	const events = new Map<string, () => void>();
	let bridge: ClientBridge | null = null;
	const invoke = vi
		.fn<(channel: string, ...payload: unknown[]) => Promise<unknown>>()
		.mockResolvedValue("document-test");
	const errors = vi.fn();
	const electron = {
		ipcRenderer: {
			on: (name: string, listener: () => void) => events.set(name, listener),
			invoke,
		},
		contextBridge: {
			exposeInMainWorld: (name: string, value: ClientBridge) => {
				if (name === "holtburgerClient") bridge = value;
			},
		},
	};
	const source = readFileSync(
		new URL("./preload.cts", import.meta.url),
		"utf8",
	);
	const code = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
	runInNewContext(code, {
		require: (name: string) => {
			if (name !== "electron")
				throw new Error(`Unexpected preload require: ${name}`);
			return electron;
		},
		process: { argv: ["--holtburger-mode=client"] },
		console: { error: errors },
		exports: {},
	});
	return {
		invoke,
		errors,
		bridge: () => {
			if (bridge === null) throw new Error("Client bridge not exposed.");
			return bridge;
		},
		request: () => {
			const listener = events.get("client:prepare-close");
			if (listener === undefined)
				throw new Error("Close listener not installed.");
			listener();
		},
	};
}

describe("client preload close handoff", () => {
	it("routes product Quit to native preparation while leaving the renderer alive", async () => {
		const app = setup();
		await app.bridge().quit();
		expect(app.invoke).toHaveBeenCalledWith(
			"client:request-close",
			"document-test",
		);
	});

	it("buffers an early native request until renderer registration and acknowledges only once", async () => {
		const app = setup();
		app.request();
		app.request();
		expect(app.invoke).toHaveBeenCalledExactlyOnceWith("document:boot");
		const prepare = vi.fn(async (): Promise<ClientClosePreparation> => ({
			kind: "prepared",
		}));
		app.bridge().onPrepareClose(prepare);
		await vi.waitFor(() =>
			expect(app.invoke).toHaveBeenCalledWith(
				"client:prepared-close",
				"document-test",
				{ kind: "prepared" },
			),
		);
		app.request();
		expect(prepare).toHaveBeenCalledOnce();
		expect(app.errors).not.toHaveBeenCalled();
	});
	it("unregisters a retired handler before delivering a later native request", async () => {
		const app = setup();
		const old = vi.fn(async (): Promise<ClientClosePreparation> => ({
			kind: "prepared",
		}));
		app.bridge().onPrepareClose(old)();
		app.request();
		expect(old).not.toHaveBeenCalled();
		const replacement = vi.fn(async (): Promise<ClientClosePreparation> => ({
			kind: "prepared",
		}));
		app.bridge().onPrepareClose(replacement);
		await vi.waitFor(() => expect(replacement).toHaveBeenCalledOnce());
		expect(old).not.toHaveBeenCalled();
	});
	it("acknowledges a rejected renderer preparation as failure", async () => {
		const app = setup();
		app.bridge().onPrepareClose(async () => {
			throw new Error("Settings flush failed");
		});
		app.request();
		await vi.waitFor(() =>
			expect(app.invoke).toHaveBeenCalledWith(
				"client:prepared-close",
				"document-test",
				expect.objectContaining({ kind: "failed" }),
			),
		);
	});
});
