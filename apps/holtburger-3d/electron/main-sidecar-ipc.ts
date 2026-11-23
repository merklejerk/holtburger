import { app, shell } from "electron";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defaultContentRoot } from "../scripts/entry-paths.mjs";
import { uiThemeIdSchema } from "../src/app/theme/ui-theme-contract.js";
import { decodeClientExitRequested } from "../src/client/session/exit-contract.js";
import type { HostCommandResult } from "../src/lib/host/host-command-result.js";
import {
	hostCommandNamesForMode,
	hostEventNamesForMode,
	type HostCommandArguments,
	type HostCommandName,
	type HostMode,
} from "../src/lib/host/host-transport.js";
import {
	MAX_RENDERER_EVIDENCE_BYTES,
	type AppFailureKind,
	type AppFailureReportStore,
} from "./app-failure-report.js";
import type { ApplicationWindow } from "./application-window.js";
import type { ClientApplication } from "./client-application.js";
import type { ContentPreferenceStore } from "./content-preference-store.js";
import { ContentStartup } from "./content-startup.js";
import { SidecarHostClient, SidecarProtocolError } from "./host-protocol.js";
import { launchHost, type EntryArguments } from "./main-entry.js";
import { requireApplicationFrame, type IpcHandleFn } from "./main-ipc-guard.js";
import { chooseContentFolder } from "./main-window.js";
import type { RuntimeLog } from "./runtime-log.js";
import type { UiThemeCatalog } from "./ui-theme-catalog.js";
import type { DocumentAdmission } from "./document-admission.js";

export interface ContentStartupContext {
	readonly window: ApplicationWindow;
	readonly mode: HostMode;
	readonly entry: EntryArguments;
	readonly store: ContentPreferenceStore;
	readonly clearContent: boolean;
	readonly overridePath: string | null;
	readonly weenieCatalogPath?: string | null;
	readonly isCurrent: () => boolean;
	readonly detach: (() => void)[];
	readonly getDesktop: () => Pick<ClientApplication<never>, "back"> | undefined;
	readonly isQuitting: () => boolean;
	readonly saveAppFailure: (
		kind: AppFailureKind,
		message: string,
	) => Promise<void>;
}

export function createContentStartup(
	context: ContentStartupContext,
): ContentStartup<SidecarHostClient> {
	const { window, mode, entry, store, isCurrent, detach } = context;
	const startup = new ContentStartup({
		store,
		overridePath: context.overridePath,
		noContentSearch: entry.noContentSearch,
		clearContent: context.clearContent,
		defaultDiscoveryRoot: () =>
			defaultContentRoot(
				process.env.HOLTBURGER_DEFAULT_CONTENT,
				process.cwd(),
				join(dirname(process.execPath), "dats"),
			),
		launch: (selection) =>
			launchHost(mode, entry.ignoreWorldMapCache, selection, {
				weenieCatalogPath: context.weenieCatalogPath,
			}),
		admit: async (client) => {
			for (const event of hostEventNamesForMode(mode)) {
				const unlisten = await client.listen(event, (payload) => {
					if (isCurrent() && !window.native.isDestroyed()) {
						window.webContents.send("host:event", { event, payload });
						const desktop = context.getDesktop();
						if (
							event === "client-exit-requested" &&
							desktop !== undefined &&
							!context.isQuitting()
						) {
							const exit = decodeClientExitRequested(payload);
							if (
								exit.cause !== "explicit-disconnect" &&
								exit.cause !== "host-shutdown"
							) {
								if (exit.diagnostic !== null)
									void context.saveAppFailure("session", exit.diagnostic);
								void desktop.back(exit.diagnostic).catch(console.error);
							}
						}
					}
				});
				if (isCurrent()) detach.push(unlisten);
				else unlisten();
			}
		},
		pickFolder: (previous) => chooseContentFolder(window, previous),
	});
	detach.push(
		startup.listen((snapshot) => {
			if (isCurrent() && !window.native.isDestroyed()) {
				window.webContents.send("content:state", snapshot);
				const phase = snapshot.phase;
				const quitting = context.isQuitting();
				if (
					!quitting &&
					(phase.kind === "fatal" ||
						phase.kind === "restart_required" ||
						phase.kind === "persistence_failed")
				)
					void context.saveAppFailure("content", phase.message);
				const desktop = context.getDesktop();
				if (
					snapshot.phase.kind === "fatal" &&
					desktop !== undefined &&
					!quitting
				) {
					void desktop.back(snapshot.phase.message).catch(console.error);
				}
			}
		}),
	);
	return startup;
}

export function installContentIpc(context: {
	readonly handle: IpcHandleFn;
	readonly currentContent: () => ContentStartup<SidecarHostClient> | undefined;
	readonly getDesktop: () => Pick<ClientApplication<never>, "back"> | undefined;
	readonly saveAppFailure: (
		kind: AppFailureKind,
		message: string,
	) => Promise<void>;
}): void {
	const requireContent = () => {
		const content = context.currentContent();
		if (!content) throw new Error("Content startup is unavailable");
		return content;
	};
	context.handle(
		"content:snapshot",
		undefined,
		() => requireContent().snapshot,
	);
	context.handle("content:choose", undefined, () => requireContent().choose());
	context.handle("content:retry", undefined, () => requireContent().retry());
	context.handle("content:quit", undefined, () => app.quit());
	context.handle(
		"launcher:back",
		["client", "explorer"],
		(_event, diagnostic: unknown) => {
			const localFailure = z.string().nullable().parse(diagnostic);
			const phase = context.currentContent()?.snapshot.phase;
			const contentFailure =
				phase?.kind === "fatal" || phase?.kind === "restart_required"
					? phase.message
					: null;
			if (localFailure !== null && localFailure !== contentFailure)
				void context.saveAppFailure("session", localFailure);
			void context
				.getDesktop()
				?.back(localFailure ?? contentFailure)
				.catch(console.error);
		},
	);
}

function isHostCommandName(
	command: string,
	mode: HostMode,
): command is HostCommandName {
	return new Set(hostCommandNamesForMode(mode)).has(command as HostCommandName);
}

function isHostCommandArguments(value: unknown): value is HostCommandArguments {
	return (
		value === undefined ||
		(typeof value === "object" && value !== null && !Array.isArray(value))
	);
}

export function installIpcBridge(context: {
	readonly window: ApplicationWindow;
	readonly handle: IpcHandleFn;
	readonly isQuitting: () => boolean;
	readonly requireActiveMode: () => HostMode;
	readonly requireClientAttempt: () => {
		readonly startup: Parameters<SidecarHostClient["startClient"]>[0];
		readonly cancellation: AbortController;
		launch: Promise<void> | null;
	};
	readonly requireActiveHost: () => SidecarHostClient;
}): void {
	const { window, handle } = context;
	handle("client:start", "client", async (event) => {
		requireApplicationFrame(event, window);
		if (context.isQuitting())
			throw new Error(
				"Client launch is unavailable while the application is closing.",
			);
		const attempt = context.requireClientAttempt();
		if (attempt.cancellation.signal.aborted)
			throw new Error("Client attempt is retiring");
		attempt.launch ??= context.requireActiveHost().startClient(attempt.startup);
		await attempt.launch;
	});
	handle(
		"host:invoke",
		["client", "explorer"],
		async (event, request: unknown) => {
			requireApplicationFrame(event, window);
			if (
				typeof request !== "object" ||
				request === null ||
				!("command" in request) ||
				typeof request.command !== "string"
			) {
				throw new Error("host request envelope is malformed");
			}
			const mode = context.requireActiveMode();
			if (!isHostCommandName(request.command, mode)) {
				throw new Error(
					`host command is not allowlisted for ${mode} mode: ${request.command}`,
				);
			}
			const args = "args" in request ? request.args : undefined;
			if (!isHostCommandArguments(args))
				throw new Error("host command arguments must be an object");

			// Renderer preparation withdraws input and drains construction/teardown RPC. The document
			// retirement acknowledgement, not the cancellation signal, is the native admission cutoff.

			const client = context.requireActiveHost();
			try {
				return {
					kind: "ok",
					value: await client.invoke(request.command, args),
				} satisfies HostCommandResult;
			} catch (error) {
				if (!(error instanceof SidecarProtocolError)) throw error;
				return {
					kind: "failed",
					error: {
						code: error.code,
						message: error.message,
						resource: error.resource,
					},
				} satisfies HostCommandResult;
			}
		},
	);
}

export function installThemesAndDiagnosticsIpc(context: {
	readonly handle: IpcHandleFn;
	readonly themes: UiThemeCatalog;
	readonly clientRuntimeLog: RuntimeLog;
	readonly documents: DocumentAdmission;
	readonly failureReports: AppFailureReportStore;
	readonly persistAppFailure: (
		kind: AppFailureKind,
		message: string,
	) => Promise<void>;
}): void {
	const { handle, themes, clientRuntimeLog, documents, failureReports } =
		context;
	handle("themes:list", undefined, () => themes.list());
	handle("themes:resolve", undefined, (_event, id: unknown) =>
		themes.resolve(uiThemeIdSchema.parse(id)),
	);
	handle("themes:open-directory", undefined, async () => {
		const error = await shell.openPath(await themes.directory());
		if (error) throw new Error(`Could not open themes directory: ${error}`);
	});
	handle(
		"diagnostics:read-runtime-log",
		["client", "explorer"],
		(_event, since: unknown) =>
			clientRuntimeLog.read(z.number().int().min(-1).parse(since)),
	);
	handle("diagnostics:save-failure", undefined, (_event, input: unknown) => {
		if (documents.role !== "client" && documents.role !== "explorer")
			throw new Error("Game failure reports require a game document");
		const failure = z
			.discriminatedUnion("kind", [
				z.object({ kind: z.literal("renderer"), report: z.string() }),
				z.object({ kind: z.literal("startup"), message: z.string().max(4096) }),
			])
			.parse(input);
		if (failure.kind === "startup")
			return context.persistAppFailure("startup", failure.message);
		if (Buffer.byteLength(failure.report) > MAX_RENDERER_EVIDENCE_BYTES)
			throw new Error("Renderer evidence exceeds 64 KiB");
		const reason = failureReports.retainRendererEvidence(failure.report);
		return context.persistAppFailure("renderer", reason);
	});
}
