import { app, ipcMain, Menu, screen } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AppFailureReportStore,
	type AppFailureKind,
} from "./app-failure-report.js";
import { AppSettingsStore, applyAppGraphicsSettings } from "./app-settings.js";
import type { AppUpdates } from "./app-updates.js";
import { applicationMenuTemplate } from "./application-menu.js";
import type { ApplicationWindow } from "./application-window.js";
import type { ClientApplication } from "./client-application.js";
import type { ClientRetirement } from "./client-retirement.js";
import { clientUserDataPath } from "./client-user-data.js";
import type { ContentStartup } from "./content-startup.js";
import { DocumentAdmission, type DocumentRole } from "./document-admission.js";
import type { SidecarHostClient } from "./host-protocol.js";
import { entryArguments, type EntryArguments } from "./main-entry.js";
import { createIpcHandle } from "./main-ipc-guard.js";
import { installClientSession, type NativeAttempt } from "./main-session.js";
import {
	createContentStartup,
	installContentIpc,
	installIpcBridge,
	installThemesAndDiagnosticsIpc,
} from "./main-sidecar-ipc.js";
import { installAppUpdates } from "./main-updates.js";
import {
	changeWindowDisplay,
	createWindow,
	loadEntry,
	reportFatalError,
	type WindowGeometrySlot,
} from "./main-window.js";
import { RuntimeLog } from "./runtime-log.js";
import { UiThemeCatalog } from "./ui-theme-catalog.js";
import {
	installUiThemeProtocol,
	registerUiThemeScheme,
} from "./ui-theme-protocol.js";

registerUiThemeScheme();

if (!app.isPackaged) {
	const developmentUserData = clientUserDataPath(
		app.getPath("appData"),
		app.getName(),
		false,
	);
	mkdirSync(developmentUserData, { recursive: true });
	app.setPath("userData", developmentUserData);
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
// Forge copies the native-window image outside ASAR; development reads the same export.
const applicationIconPath = app.isPackaged
	? join(process.resourcesPath, "icon.png")
	: resolve(app.getAppPath(), "../../assets/branding/icon.png");

/** Exact application contents admit IPC independently of native surface replacement. */
let applicationWindow: ApplicationWindow | null = null;
let explorerContent: ContentStartup<SidecarHostClient> | undefined;
/** The selected desktop profile owns one latest failure report. */
const failureReports = new AppFailureReportStore(
	join(app.getPath("userData"), "last-failure.json"),
);
const clientRuntimeLog = new RuntimeLog();
const documents = new DocumentAdmission();
let quitting = false;
/** Client window close joins renderer preparation before native store/process shutdown. */
let documentRetirement: ClientRetirement | undefined;
let exitCode = 0;
let fatalReported = false;
let desktop: ClientApplication<NativeAttempt> | undefined;
/** Update availability survives native document replacement and never owns the game lifecycle. */
let appUpdates: AppUpdates | undefined;
const geometrySlot: WindowGeometrySlot = {
	windowDisplay: null,
	stopGeometry: null,
};

function persistAppFailure(
	kind: AppFailureKind,
	message: string,
): Promise<void> {
	return failureReports.save(kind, message, {
		version: app.getVersion(),
		document: documents.role,
	});
}

function saveAppFailure(kind: AppFailureKind, message: string): Promise<void> {
	return persistAppFailure(kind, message).catch((error: unknown) =>
		console.error("Could not save application failure report.", error),
	);
}

function fatalError(
	title: string,
	error: unknown,
	kind: AppFailureKind = "startup",
): void {
	reportFatalError(
		title,
		error,
		{
			isFatalReported: () => fatalReported,
			markFatalReported: () => {
				fatalReported = true;
			},
			setExitCode: (code) => {
				exitCode = code;
			},
			saveAppFailure,
		},
		kind,
	);
}

const handle = createIpcHandle({
	getApplicationWindow: () => applicationWindow,
	documents,
	getDocumentRetirement: () => documentRetirement,
	getDesktopCanPlay: () => desktop?.canPlay,
});

/** Client content belongs to its attempt; only Explorer keeps an application-lived content host. */
function currentContent(): ContentStartup<SidecarHostClient> | undefined {
	return desktop === undefined ? explorerContent : desktop.attempt?.content;
}

function requireActiveHost(): SidecarHostClient {
	const host = currentContent()?.activeHost;
	if (host === undefined || host === null)
		throw new Error("Game commands are unavailable during asset setup");
	return host;
}

void (async () => {
	let entry: EntryArguments;
	let appSettings: AppSettingsStore;
	let graphicsOverrides: readonly string[];
	try {
		entry = entryArguments();
		appSettings = new AppSettingsStore(
			join(app.getPath("userData"), "app-settings.json"),
			process.platform,
		);
		graphicsOverrides = applyAppGraphicsSettings(
			appSettings.settings,
			app.commandLine,
		);
	} catch (error) {
		await app.whenReady();
		fatalError("Holtburger 3D launch arguments are invalid", error);
		return;
	}
	const startupSettings = appSettings.settings;
	await app.whenReady();
	app.dock?.setIcon(applicationIconPath);
	const menuTemplate = applicationMenuTemplate(process.platform);
	Menu.setApplicationMenu(
		menuTemplate === null ? null : Menu.buildFromTemplate(menuTemplate),
	);
	const window = createWindow(entry, {
		applicationIconPath,
		preloadPath: join(currentDirectory, "preload.cjs"),
		handle,
		getDocumentRetirement: () => documentRetirement,
		isQuitting: () => quitting,
		getDocumentRole: () => documents.role,
		clientRuntimeLog,
		failureReports,
		getWindowDisplay: () => geometrySlot.windowDisplay,
		changeWindowDisplay: (request) =>
			changeWindowDisplay(
				geometrySlot,
				() => {
					const resources = desktop?.attempt?.resources;
					if (!resources || resources.kind === "pending")
						throw new Error("Game settings are not ready");
					return resources.settings;
				},
				request,
			),
		onFatalError: fatalError,
	});
	applicationWindow = window;
	const refreshDisplay = () => geometrySlot.windowDisplay?.refresh();
	screen.on("display-metrics-changed", refreshDisplay);
	window.once("closed", () =>
		screen.removeListener("display-metrics-changed", refreshDisplay),
	);
	const themes = new UiThemeCatalog(
		join(app.getPath("userData"), "themes"),
		console.error,
	);
	installUiThemeProtocol(window.webContents.session, themes);
	ipcMain.handle("document:boot", (event) => {
		const frame = event.senderFrame;
		if (
			event.sender !== window.webContents ||
			frame === null ||
			frame !== window.webContents.mainFrame
		)
			throw new Error("Document boot requires the application frame");
		return documents.boot(frame.url);
	});
	installThemesAndDiagnosticsIpc({
		handle,
		themes,
		clientRuntimeLog,
		documents,
		failureReports,
		persistAppFailure,
	});
	installIpcBridge({
		window,
		mode: entry.mode,
		handle,
		isQuitting: () => quitting,
		requireClientAttempt: () => {
			const attempt = desktop?.attempt;
			if (!attempt) throw new Error("No game attempt is active");
			return attempt;
		},
		requireActiveHost,
	});
	installContentIpc({
		handle,
		currentContent,
		getDesktop: () => desktop,
		saveAppFailure,
	});
	app.on("child-process-gone", (_event, details) => {
		if (quitting || details.reason === "clean-exit") return;
		void saveAppFailure(
			"process",
			`Chromium ${details.type} process stopped (reason=${details.reason}, exitCode=${details.exitCode}).`,
		);
	});
	const navigate = async (role: DocumentRole, path: string) => {
		appUpdates?.clearPregame();
		documents.navigate(role, path);
		await loadEntry(window, path, entry.mode);
	};
	if (entry.mode === "explorer") {
		explorerContent = createContentStartup({
			window,
			entry,
			clearContent: entry.clearContent,
			overridePath: entry.contentPath,
			isCurrent: () => !quitting,
			detach: [],
			getDesktop: () => desktop,
			isQuitting: () => quitting,
			saveAppFailure,
		});
		await navigate("explorer", entry.path);
		await explorerContent.start();
		return;
	}

	const updates = installAppUpdates({
		window,
		noUpdates: entry.noUpdates,
		handle,
		documents,
		getApplicationWindow: () => applicationWindow,
		getDocumentRetirement: () => documentRetirement,
	});
	appUpdates = updates;

	const session = await installClientSession({
		window,
		entry,
		handle,
		documents,
		updates,
		geometrySlot,
		appSettings,
		startupSettings,
		graphicsOverrides,
		failureReports,
		navigate,
		saveAppFailure,
		isQuitting: () => quitting,
		markQuitting: () => {
			quitting = true;
		},
		isFatalReported: () => fatalReported,
		getExitCode: () => exitCode,
		setExitCode: (code) => {
			exitCode = code;
		},
		getDocumentRetirement: () => documentRetirement,
		setDocumentRetirement: (retirement) => {
			documentRetirement = retirement;
		},
	});
	desktop = session.owner;

	const directStartup = entry.clientStartup;
	if (directStartup !== undefined)
		await session.owner.play(async () => directStartup);
	else await session.showPicker(null);
})().catch((error: unknown) =>
	fatalError("Holtburger 3D failed to start", error),
);

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
	appUpdates?.stop();
	if (desktop !== undefined) {
		event.preventDefault();
		quitting = true;
		void desktop.quit();
		return;
	}
	if (quitting || !explorerContent) return;
	event.preventDefault();
	quitting = true;
	void explorerContent
		.close()
		.catch((error: unknown) => {
			console.error(error);
			exitCode = 1;
		})
		.finally(async () => {
			await failureReports.flush();
			app.exit(exitCode);
		});
});
