import { app, ipcMain, powerMonitor, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type { PregameRegistrationStatus } from "../src/app/app-update-contract.js";
import { AppUpdates, loadUpdateBuild } from "./app-updates.js";
import type { ApplicationWindow } from "./application-window.js";
import type { ClientRetirement } from "./client-retirement.js";
import type { DocumentAdmission } from "./document-admission.js";
import { requireApplicationFrame, type IpcHandleFn } from "./main-ipc-guard.js";

export interface AppUpdatesContext {
	readonly window: ApplicationWindow;
	readonly noUpdates: boolean;
	readonly handle: IpcHandleFn;
	readonly documents: DocumentAdmission;
	readonly getApplicationWindow: () => ApplicationWindow | null;
	readonly getDocumentRetirement: () => ClientRetirement | undefined;
}

export function installAppUpdates(context: AppUpdatesContext): AppUpdates {
	const { window, documents, handle } = context;
	const updates = new AppUpdates(
		app.isPackaged && !context.noUpdates
			? loadUpdateBuild(
					join(app.getAppPath(), "dist/build-info.json"),
					console.error,
				)
			: null,
		{
			request: fetch,
			now: Date.now,
			publish: (snapshot) => {
				if (documents.role !== null && !window.webContents.isDestroyed())
					window.webContents.send("updates:state", snapshot);
			},
			report: console.error,
			openExternal: (url) => shell.openExternal(url),
		},
	);
	const reconsiderUpdates = () => {
		if (!window.native.isDestroyed())
			updates.setWindowVisible(
				window.native.isVisible() && !window.native.isMinimized(),
			);
	};
	window.on("show", reconsiderUpdates);
	window.on("hide", reconsiderUpdates);
	window.on("minimize", reconsiderUpdates);
	window.on("restore", reconsiderUpdates);
	window.on("focus", reconsiderUpdates);
	powerMonitor.on("resume", reconsiderUpdates);
	window.once("closed", () => {
		updates.stop();
		powerMonitor.removeListener("resume", reconsiderUpdates);
	});
	handle("updates:snapshot", undefined, () => updates.snapshot);
	handle("updates:register-pregame", undefined, (_event, visible: unknown) =>
		updates.registerPregame(z.boolean().parse(visible)),
	);
	// Optional lifecycle withdrawals can arrive after native navigation seals their document.
	// Acknowledge retirement without admitting stale registration, snapshot or download actions.
	const updateRegistration = (
		event: Electron.IpcMainInvokeEvent,
		identity: unknown,
		operation: () => PregameRegistrationStatus,
	) => {
		requireApplicationFrame(event, context.getApplicationWindow());
		const retirement = context.getDocumentRetirement();
		if (
			!documents.isAdmitted(identity) ||
			(retirement !== undefined && !retirement.acceptsRendererRequests)
		)
			return "retired";
		return operation();
	};
	ipcMain.handle(
		"updates:pregame-visible",
		(event, identity: unknown, token: unknown, visible: unknown) =>
			updateRegistration(event, identity, () =>
				updates.setPregameVisible(
					z.uuid().parse(token),
					z.boolean().parse(visible),
				),
			),
	);
	ipcMain.handle(
		"updates:release-pregame",
		(event, identity: unknown, token: unknown) =>
			updateRegistration(event, identity, () =>
				updates.releasePregame(z.uuid().parse(token)),
			),
	);
	handle("updates:open-downloads", undefined, () => updates.openDownloads());
	handle("updates:refresh", undefined, () => updates.refresh());
	handle("updates:open-history", undefined, () => updates.openHistory());
	updates.start();
	reconsiderUpdates();
	return updates;
}
