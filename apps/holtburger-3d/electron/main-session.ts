import { app, clipboard, ipcMain } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type { AppSettingsSnapshot } from "../src/app/desktop/app-settings-contract.js";
import {
	APP_LIFECYCLE_TUNING,
	APP_PERSISTENCE_TUNING,
	APP_WINDOW_TUNING,
} from "../src/app/desktop/app-tuning.js";
import { DEV_RESTART_EXIT_CODE } from "../src/app/desktop/desktop-restart-contract.js";
import { windowDisplayRequestSchema } from "../src/app/desktop/window-display-contract.js";
import { equipmentCacheStageSchema } from "../src/client/inventory/equipment-cache-contract.js";
import { playerVisualCaptureSchema } from "../src/client/character/object-preview-contract.js";
import {
	clientCharacterSectionsSchema,
	clientUserSettingsPatchSchema,
} from "../src/client/settings/settings-sections.js";
import { formatError } from "../src/lib/format-error.js";
import type {
	AppFailureKind,
	AppFailureReportStore,
} from "./app-failure-report.js";
import {
	appSettingsRequireRestart,
	graphicsBackendOptions,
	type AppSettingsStore,
} from "./app-settings.js";
import type { AppUpdates } from "./app-updates.js";
import type { ApplicationWindow } from "./application-window.js";
import {
	ClientApplication,
	type ApplicationAttempt,
} from "./client-application.js";
import { ClientEquipmentCacheStore } from "./client-equipment-cache-store.js";
import type { ClientLaunchConfiguration } from "./client-launch.js";
import { clientCharacterProfileKey } from "./client-profile-key.js";
import { ClientRetirement } from "./client-retirement.js";
import {
	ClientSettingsStore,
	type ClientSettingsReadMode,
} from "./client-settings-store.js";
import { clientSettingsFilePath } from "./client-user-data.js";
import { ClientVisualCacheStore } from "./client-visual-cache-store.js";
import type { ContentStartup } from "./content-startup.js";
import type { DocumentAdmission, DocumentRole } from "./document-admission.js";
import { copyHardwareInfo } from "./hardware-info.js";
import type { SidecarHostClient } from "./host-protocol.js";
import { LauncherStore } from "./launcher-store.js";
import type { EntryArguments } from "./main-entry.js";
import {
	requireApplicationFrame,
	requireCharacterGuid,
	type IpcHandleFn,
} from "./main-ipc-guard.js";
import { createContentStartup } from "./main-sidecar-ipc.js";
import {
	changeWindowDisplay,
	chooseContentFolder,
	initialGeometry,
	reportTransitionFailure,
	reportWindowSettingsFailure,
	stopWindowGeometry,
	type WindowGeometrySlot,
} from "./main-window.js";
import { ServerDirectoryCatalog } from "./server-directory.js";
import {
	WindowDisplay,
	restoreWindowGeometry as restoreGeometry,
} from "./window-display.js";
import { observeWindowGeometry } from "./window-geometry.js";

/** Native resources are bound to exactly one admitted endpoint. */
export interface NativeAttempt extends ApplicationAttempt {
	/** Immutable endpoint plus transient credentials consumed by this attempt's private launch. */
	readonly startup: ClientLaunchConfiguration;
	/** Content admission and host lifetime are replaced together on another Play. */
	readonly content: ContentStartup<SidecarHostClient>;
	/** Partial setup retains its settings owner for flush even if cache construction never completes. */
	resources:
		| { readonly kind: "pending" }
		| { readonly kind: "settings"; readonly settings: ClientSettingsStore }
		| {
				readonly kind: "ready";
				readonly settings: ClientSettingsStore;
				readonly cache: ClientVisualCacheStore;
				readonly equipmentCache: ClientEquipmentCacheStore;
		  };
	/** Settings/navigation barrier; excludes host readiness so cancellation cannot deadlock on handshake. */
	opening: Promise<void>;
	/** Exactly one private connection request after renderer listener admission. */
	launch: Promise<void> | null;
	/** Host/startup subscriptions are detached before a replacement document is admitted. */
	readonly detach: (() => void)[];
}

interface SettingsIpcContext {
	readonly window: ApplicationWindow;
	readonly ignorePersistedConfig: boolean;
	readonly handle: IpcHandleFn;
	readonly geometrySlot: WindowGeometrySlot;
	readonly requireAttempt: () => NativeAttempt;
	readonly requireSettings: () => ClientSettingsStore;
}

function installSettingsIpcBridge(context: SettingsIpcContext): void {
	const { window, handle, geometrySlot, requireAttempt, requireSettings } =
		context;
	handle("window:display-snapshot", "client", () => {
		if (geometrySlot.windowDisplay === null)
			throw new Error("Client window controls are unavailable.");
		return geometrySlot.windowDisplay.read();
	});
	handle("window:display-change", "client", (_event, request: unknown) =>
		changeWindowDisplay(
			geometrySlot,
			requireSettings,
			windowDisplayRequestSchema.parse(request),
		),
	);
	const readMode: ClientSettingsReadMode = context.ignorePersistedConfig
		? "fresh"
		: "persisted";
	handle("settings:load-user", "client", async (event, value: unknown) => {
		requireApplicationFrame(event, window);
		const attempt = requireAttempt();
		try {
			return await requireSettings().loadUser(value, readMode);
		} catch (error) {
			// User settings load before the renderer mounts, so no toast can report
			// a failed backup or repair write. Use the existing startup error surface.
			attempt.content.fail(formatError(error));
			throw error;
		}
	});
	handle(
		"settings:save-user-patch",
		"client",
		async (event, patch: unknown) => {
			requireApplicationFrame(event, window);
			await requireSettings().saveUserPatch(
				clientUserSettingsPatchSchema.parse(patch),
			);
		},
	);
	handle("settings:reset-user", "client", async (event, settings: unknown) => {
		requireApplicationFrame(event, window);
		return requireSettings().resetUser(settings);
	});
	handle(
		"settings:load-character",
		"client",
		(event, guid: unknown, defaults: unknown) => {
			requireApplicationFrame(event, window);
			return requireSettings().loadCharacter(
				clientCharacterProfileKey(
					requireAttempt().startup,
					requireCharacterGuid(guid),
				),
				defaults,
				readMode,
			);
		},
	);
	handle(
		"settings:save-character-patch",
		"client",
		async (event, request: unknown) => {
			requireApplicationFrame(event, window);
			if (typeof request !== "object" || request === null)
				throw new Error("character settings request is malformed");
			if (!("characterGuid" in request) || !("patch" in request))
				throw new Error("character settings request is incomplete");
			const guid = requireCharacterGuid(request.characterGuid);
			await requireSettings().saveCharacterPatch(
				clientCharacterProfileKey(requireAttempt().startup, guid),
				clientCharacterSectionsSchema.parse(request.patch),
			);
		},
	);
}

export interface ClientSessionContext {
	readonly window: ApplicationWindow;
	readonly entry: EntryArguments;
	readonly handle: IpcHandleFn;
	readonly documents: DocumentAdmission;
	readonly updates: AppUpdates;
	readonly geometrySlot: WindowGeometrySlot;
	readonly appSettings: AppSettingsStore;
	readonly startupSettings: AppSettingsStore["settings"];
	readonly graphicsOverrides: readonly string[];
	readonly failureReports: AppFailureReportStore;
	readonly navigate: (role: DocumentRole, path: string) => Promise<void>;
	readonly saveAppFailure: (
		kind: AppFailureKind,
		message: string,
	) => Promise<void>;
	readonly isQuitting: () => boolean;
	readonly markQuitting: () => void;
	readonly isFatalReported: () => boolean;
	readonly getExitCode: () => number;
	readonly setExitCode: (code: number) => void;
	readonly getDocumentRetirement: () => ClientRetirement | undefined;
	readonly setDocumentRetirement: (
		retirement: ClientRetirement | undefined,
	) => void;
}

export async function installClientSession(
	context: ClientSessionContext,
): Promise<{
	readonly owner: ClientApplication<NativeAttempt>;
	readonly showPicker: (diagnostic: string | null) => Promise<void>;
}> {
	const {
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
	} = context;

	let pickerFailure: string | null = null;
	let restartRequested = false;

	const launcher = new LauncherStore(
		join(app.getPath("userData"), "launcher-settings.json"),
		initialGeometry(
			APP_WINDOW_TUNING.launcher.initialContentSize.width,
			APP_WINDOW_TUNING.launcher.initialContentSize.height,
		),
	);
	await launcher.load();
	let clearContent = entry.clearContent;
	const gamePath = entry.path;
	// CLI content overrides only the first interactive attempt or the direct launch.
	let initialContentPath =
		entry.clientStartup === undefined ? entry.contentPath : null;

	const showPicker = async (diagnostic: string | null) => {
		if (context.isQuitting()) return;
		await stopWindowGeometry(geometrySlot);
		if (context.isQuitting()) return;
		pickerFailure = diagnostic;
		context.setDocumentRetirement(undefined);
		await restoreGeometry(window, launcher.window, "picker");
		geometrySlot.stopGeometry = observeWindowGeometry(
			window,
			(value) => launcher.updateWindow(value),
			(error) => {
				pickerFailure = formatError(error);
				reportWindowSettingsFailure(window, error);
			},
			() => {
				const { width, height } = window.native.getNormalBounds();
				return {
					normalBounds: { width, height },
					maximized: window.native.isMaximized(),
					fullscreen: false,
					freeResize: true,
					borderless: false,
				};
			},
		);
		await context.navigate("picker", "launcher/index.html");
	};

	const cleanup = async (attempt: NativeAttempt) => {
		updates.clearPregame();
		documents.close();
		for (const detach of attempt.detach.splice(0)) detach();
		const results = await Promise.allSettled([
			stopWindowGeometry(geometrySlot),
			attempt.content.close(),
			attempt.resources.kind === "pending"
				? Promise.resolve()
				: attempt.resources.settings.flush(),
			attempt.resources.kind === "ready"
				? attempt.resources.cache.close()
				: Promise.resolve(),
			attempt.resources.kind === "ready"
				? attempt.resources.equipmentCache.close()
				: Promise.resolve(),
		]);
		attempt.startup.password = "";
		const failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Session retirement failed",
			);
	};

	const owner = new ClientApplication<NativeAttempt>({
		launcherEnabled: !entry.noLauncher,
		create: (startup) => {
			pickerFailure = null;
			const detach: (() => void)[] = [];
			const content = createContentStartup({
				window,
				entry,
				clearContent,
				overridePath: startup.contentPath,
				isCurrent: () => owner.attempt?.content === content,
				detach,
				getDesktop: () => owner,
				isQuitting: context.isQuitting,
				saveAppFailure: context.saveAppFailure,
			});
			return {
				startup,
				content,
				resources: { kind: "pending" },
				opening: Promise.resolve(),
				launch: null,
				detach,
				cancellation: new AbortController(),
			};
		},
		initialize: async (attempt) => {
			attempt.opening = (async () => {
				await stopWindowGeometry(geometrySlot);
				attempt.cancellation.signal.throwIfAborted();
				const settings = new ClientSettingsStore(
					entry.settingsFile ?? clientSettingsFilePath(app.getPath("userData")),
					initialGeometry(
						APP_WINDOW_TUNING.game.initialContentSize.width,
						APP_WINDOW_TUNING.game.initialContentSize.height,
					),
				);
				attempt.resources = { kind: "settings", settings };
				const repaired = await settings.load();
				if (repaired.length)
					console.warn(
						`Client window settings repaired: ${repaired.join("; ")}`,
					);
				attempt.cancellation.signal.throwIfAborted();
				const savedWindow = settings.readWindow();
				const restoredWindow = await restoreGeometry(
					window,
					savedWindow,
					"client",
				);
				const controls = new WindowDisplay(
					window,
					restoredWindow,
					(snapshot) => {
						if (!window.native.isDestroyed())
							window.webContents.send("window:display-state", snapshot);
					},
					(error) => reportWindowSettingsFailure(window, error),
				);
				geometrySlot.windowDisplay = controls;
				geometrySlot.stopGeometry = observeWindowGeometry(
					window,
					(value) => settings.updateWindow(value),
					(error) => reportWindowSettingsFailure(window, error),
					() => controls.settings(),
				);
				const cache = new ClientVisualCacheStore(
					join(app.getPath("userData"), "character-visuals"),
					attempt.startup,
					APP_PERSISTENCE_TUNING.visualCacheWriteDelayMs,
					(message) => {
						console.error(message);
						if (owner.attempt === attempt && !window.native.isDestroyed())
							window.webContents.send("visual-cache:failure", message);
					},
				);
				const equipmentCache = new ClientEquipmentCacheStore(
					join(app.getPath("userData"), "equipment-cache"),
					attempt.startup,
					APP_PERSISTENCE_TUNING.visualCacheWriteDelayMs,
					(message) => {
						console.error(message);
						if (owner.attempt === attempt && !window.native.isDestroyed())
							window.webContents.send("equipment-cache:failure", message);
					},
				);
				attempt.resources = { kind: "ready", settings, cache, equipmentCache };
				context.setDocumentRetirement(undefined);
				await context.navigate("client", gamePath);
				attempt.cancellation.signal.throwIfAborted();
			})();
			try {
				await attempt.opening;
				attempt.cancellation.signal.throwIfAborted();
				clearContent = false;
				await attempt.content.start();
			} catch (error) {
				if (!attempt.cancellation.signal.aborted)
					void context.saveAppFailure("startup", formatError(error));
				throw error;
			}
		},
		retire: async (attempt) => {
			updates.clearPregame();
			// Opening contains settings/navigation only; host readiness must be cancelled by native close.
			try {
				await attempt.opening;
			} catch (error) {
				if (!attempt.cancellation.signal.aborted) throw error;
			}
			const retirement = new ClientRetirement({
				deadlineMs: APP_LIFECYCLE_TUNING.rendererClosePreparationTimeoutMs,
				prepareRenderer: () => {
					if (
						documents.role !== "client" ||
						window.native.isDestroyed() ||
						context.isFatalReported()
					) {
						retirement.acceptPreparation({ kind: "prepared" });
						return;
					}
					window.webContents.send("client:prepare-close");
				},
				shutdownNative: () => cleanup(attempt),
			});
			context.setDocumentRetirement(retirement);
			const preparation = await retirement.request();
			if (preparation.kind === "failed") {
				pickerFailure = preparation.diagnostic;
				console.error(preparation.diagnostic);
				if (context.isQuitting()) context.setExitCode(1);
			}
		},
		showPicker: async (diagnostic) => {
			const messages = new Set(
				[diagnostic, pickerFailure].filter(
					(value): value is string => value !== null,
				),
			);
			await showPicker(messages.size === 0 ? null : [...messages].join("\n"));
		},
		flushLauncher: async () => {
			// Independent writes must settle even when another persistence owner fails.
			const results = await Promise.allSettled([
				(async () => {
					if (owner.attempt === null) await stopWindowGeometry(geometrySlot);
					await launcher.flush();
				})(),
				appSettings.flush(),
				failureReports.flush(),
			]);
			const failures = results.flatMap((result) =>
				result.status === "rejected" ? [formatError(result.reason)] : [],
			);
			if (failures.length > 0) throw new Error(failures.join("\n"));
		},
		exit: (failures) => {
			for (const failure of failures) console.error(failure);
			if (restartRequested && failures.length === 0) {
				if (
					!app.isPackaged &&
					process.env.HOLTBURGER_ELECTRON_SUPERVISED === "1"
				) {
					// The dev launcher owns Vite and must also own replacement Electron processes.
					app.exit(DEV_RESTART_EXIT_CODE);
					return;
				}
				app.relaunch();
			}
			app.exit(failures.length ? 1 : context.getExitCode());
		},
		report: (diagnostic) =>
			reportTransitionFailure(window, new Error(diagnostic), {
				setPickerFailure: (message) => {
					pickerFailure = message;
				},
				saveAppFailure: context.saveAppFailure,
			}),
	});

	const requireAttempt = (): NativeAttempt => {
		const attempt = owner.attempt;
		if (!attempt) throw new Error("No game attempt is active");
		return attempt;
	};
	const requireSettings = (): ClientSettingsStore => {
		const resources = requireAttempt().resources;
		if (resources.kind === "pending")
			throw new Error("Game settings are not ready");
		return resources.settings;
	};
	const requireCache = (): ClientVisualCacheStore => {
		const resources = requireAttempt().resources;
		if (resources.kind !== "ready")
			throw new Error("Character visual cache is not ready");
		return resources.cache;
	};
	const requireEquipmentCache = (): ClientEquipmentCacheStore => {
		const resources = requireAttempt().resources;
		if (resources.kind !== "ready")
			throw new Error("Equipment cantrip cache is not ready");
		return resources.equipmentCache;
	};

	installSettingsIpcBridge({
		window,
		ignorePersistedConfig: entry.ignorePersistedConfig,
		handle,
		geometrySlot,
		requireAttempt,
		requireSettings,
	});

	handle("visual-cache:read", "client", (_event, guid: unknown) =>
		requireCache().read(requireCharacterGuid(guid)),
	);
	handle("visual-cache:stage", "client", (_event, capture: unknown) =>
		requireCache().stage(playerVisualCaptureSchema.parse(capture)),
	);
	handle("equipment-cache:read-all", "client", () =>
		requireEquipmentCache().readAll(),
	);
	handle("equipment-cache:stage", "client", (_event, capture: unknown) =>
		requireEquipmentCache().stage(equipmentCacheStageSchema.parse(capture)),
	);
	handle("launcher:snapshot", "picker", () =>
		launcher.snapshot(pickerFailure, owner.canPlay),
	);
	handle(
		"launcher:app-settings",
		"picker",
		async (): Promise<AppSettingsSnapshot> => {
			let renderer: string | null = null;
			let gpuDiagnostic: string | null = null;
			try {
				// Electron returns Chromium's evolving GPUInfo shape; consume only its renderer string.
				const info = z
					.object({
						auxAttributes: z.object({ glRenderer: z.string().optional() }),
					})
					.parse(await app.getGPUInfo("complete"));
				renderer = info.auxAttributes.glRenderer ?? null;
			} catch (error) {
				gpuDiagnostic = `Graphics information could not be read: ${formatError(error)}`;
			}
			const settings = appSettings.settings;
			return {
				settings,
				defaults: appSettings.defaults,
				backends: graphicsBackendOptions(process.platform),
				restartRequired: appSettingsRequireRestart(startupSettings, settings),
				overrides: graphicsOverrides,
				renderer,
				hardwareAcceleration: app.isHardwareAccelerationEnabled(),
				diagnostic:
					[appSettings.diagnostic, gpuDiagnostic]
						.filter((value) => value !== null)
						.join("\n") || null,
			};
		},
	);
	handle("launcher:save-app-settings", "picker", (_event, input: unknown) =>
		appSettings.save(input),
	);
	handle("launcher:copy-last-failure", "picker", async () => {
		const report = await failureReports.read();
		if (report === null) return false;
		clipboard.writeText(report);
		return true;
	});
	handle("launcher:copy-hardware-info", "picker", (_event, input: unknown) =>
		copyHardwareInfo(
			window.native,
			input,
			startupSettings,
			appSettings.settings,
			graphicsOverrides,
		),
	);
	handle("launcher:restart", "picker", async () => {
		restartRequested = true;
		context.markQuitting();
		await owner.quit();
	});

	const directory = new ServerDirectoryCatalog(fetch);
	handle(
		"launcher:choose-content-path",
		"picker",
		async (_event, previous: unknown) => {
			const path = z.string().min(1).nullable().parse(previous);
			return chooseContentFolder(window, path);
		},
	);
	handle("launcher:directory", "picker", async (_event, refresh: unknown) => {
		await directory.load(z.boolean().parse(refresh));
		return directory.view(
			launcher.snapshot(pickerFailure, owner.canPlay).servers,
		);
	});
	handle("launcher:import-server", "picker", (_event, key: unknown) =>
		launcher.importServer(directory.select(key)),
	);
	handle("launcher:save-server", "picker", (_event, value: unknown) =>
		launcher.saveServer(value),
	);
	handle("launcher:delete-server", "picker", (_event, id: unknown) =>
		launcher.deleteServer(z.string().uuid().parse(id)),
	);
	handle("launcher:save-profile", "picker", (_event, value: unknown) =>
		launcher.saveProfile(value),
	);
	handle("launcher:delete-profile", "picker", (_event, id: unknown) =>
		launcher.deleteProfile(z.string().uuid().parse(id)),
	);
	handle("launcher:credentials", "picker", (_event, selection: unknown) =>
		launcher.credentials(selection),
	);
	handle("launcher:play", "picker", (_event, selection: unknown) =>
		owner.play(async () => {
			const startup = await launcher.select(selection);
			const contentPath = initialContentPath ?? startup.contentPath;
			initialContentPath = null;
			return { ...startup, contentPath };
		}),
	);
	ipcMain.handle("client:request-close", (event, identity: unknown) => {
		requireApplicationFrame(event, window);
		documents.requireIdentity(identity);
		app.quit();
	});
	handle("client:prepared-close", "client", (_event, payload: unknown) => {
		context.getDocumentRetirement()?.acceptPreparation(payload);
	});
	window.on("close", (event: Electron.Event) => {
		event.preventDefault();
		updates.stop();
		context.markQuitting();
		void owner.quit();
	});
	window.webContents.on(
		"did-start-navigation",
		(_event, _url, inPlace, mainFrame) => {
			const retirement = context.getDocumentRetirement();
			if (mainFrame && !inPlace && retirement?.preparing)
				retirement.rendererUnavailable(
					"Client renderer navigated during retirement preparation.",
				);
		},
	);

	return { owner, showPicker };
}
