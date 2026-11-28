import { constants, readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	appSettingsSchema,
	DEFAULT_LIVE_API_SETTINGS,
	type AppSettings,
	type GraphicsBackendOption,
} from "../src/app/desktop/app-settings-contract.js";
import { formatError } from "../src/lib/format-error.js";
import { replaceLocalFile } from "./replace-local-file.js";

/** Windows uses accelerated D3D11 presentation with display synchronization off. */
function defaultAppSettings(platform: NodeJS.Platform): AppSettings {
	return platform === "win32"
		? {
				graphicsBackend: "d3d11",
				vsync: false,
				gpuCompositing: true,
				liveApi: { ...DEFAULT_LIVE_API_SETTINGS },
			}
		: {
				graphicsBackend: "automatic",
				vsync: true,
				gpuCompositing: true,
				liveApi: { ...DEFAULT_LIVE_API_SETTINGS },
			};
}

/** Native settings projections share the same restart decision. */
export function appSettingsRequireRestart(
	startup: AppSettings,
	saved: AppSettings,
): boolean {
	return (
		startup.graphicsBackend !== saved.graphicsBackend ||
		startup.vsync !== saved.vsync ||
		startup.gpuCompositing !== saved.gpuCompositing
	);
}

/** Backend choices reflect APIs shipped for each desktop platform. */
export function graphicsBackendOptions(
	platform: NodeJS.Platform,
): readonly GraphicsBackendOption[] {
	const automatic: GraphicsBackendOption = {
		value: "automatic",
		label: "Automatic",
	};
	switch (platform) {
		case "win32":
			return [
				automatic,
				{ value: "d3d11", label: "Direct3D 11" },
				{ value: "gl", label: "OpenGL" },
			];
		case "darwin":
			return [automatic, { value: "metal", label: "Metal" }];
		default:
			return [automatic, { value: "gl", label: "OpenGL" }];
	}
}

/** Small Electron command-line surface also used to test preference/CLI precedence. */
interface StartupCommandLine {
	hasSwitch(name: string): boolean;
	getSwitchValue(name: string): string;
	appendSwitch(name: string, value?: string): void;
	removeSwitch(name: string): void;
}

const WAYLAND_FRACTIONAL_SCALE_FEATURE = "WaylandFractionalScaleV1";

function hasFeatureFlag(value: string, feature: string): boolean {
	return value
		.split(",")
		.some((entry) => entry.trim().split(/[:<]/, 1)[0] === feature);
}

/**
 * Apply platform-specific Chromium startup switches after CLI launch flags are registered.
 * On Linux Wayland with a non-1.0 desktop text scale, Chromium's WaylandFractionalScaleV1
 * ui_scale round-trip grows the window and viewport by +1px on every focus/blur configure
 * event, compounding into persisted window geometry across sessions.
 */
export function applyPlatformStartupSwitches(
	platform: NodeJS.Platform,
	commandLine: StartupCommandLine,
): void {
	if (platform === "win32") {
		// Request the faster adapter on hybrid laptops; OS and driver selection may prevail.
		if (!commandLine.hasSwitch("force-high-performance-gpu"))
			commandLine.appendSwitch("force-high-performance-gpu");
		return;
	}
	if (platform !== "linux") return;
	if (
		hasFeatureFlag(
			commandLine.getSwitchValue("enable-features"),
			WAYLAND_FRACTIONAL_SCALE_FEATURE,
		)
	)
		return;
	const existing = commandLine.getSwitchValue("disable-features");
	if (hasFeatureFlag(existing, WAYLAND_FRACTIONAL_SCALE_FEATURE)) return;
	const next =
		existing.trim().length === 0
			? WAYLAND_FRACTIONAL_SCALE_FEATURE
			: `${existing},${WAYLAND_FRACTIONAL_SCALE_FEATURE}`;
	if (commandLine.hasSwitch("disable-features"))
		commandLine.removeSwitch("disable-features");
	commandLine.appendSwitch("disable-features", next);
}

/** Configure synchronously before ready; explicit diagnostic launch arguments win. */
export function applyAppGraphicsSettings(
	settings: AppSettings,
	commandLine: StartupCommandLine,
): readonly string[] {
	const names = [
		"use-angle",
		"enable-vsync",
		"disable-gpu-vsync",
		"disable-frame-rate-limit",
		"disable-gpu-compositing",
	];
	const overrides = names.filter((name) => commandLine.hasSwitch(name));
	if (!settings.gpuCompositing)
		commandLine.appendSwitch("disable-gpu-compositing");
	if (
		!commandLine.hasSwitch("use-angle") &&
		settings.graphicsBackend !== "automatic"
	)
		commandLine.appendSwitch("use-angle", settings.graphicsBackend);
	if (commandLine.hasSwitch("enable-vsync")) {
		// Chromium's frame-rate bypass also disables vsync in its GPU subprocess.
		commandLine.removeSwitch("disable-gpu-vsync");
		commandLine.removeSwitch("disable-frame-rate-limit");
	} else if (!settings.vsync) {
		commandLine.appendSwitch("disable-gpu-vsync");
	}
	return overrides.map((name) => `--${name}`);
}

// Unknown sections are retired on the next canonical save rather than imported.
const savedAppSettingsSchema = z
	.object({
		version: z.literal(1),
		/** Shared policy scope starts fresh across platforms; later choices persist here. */
		graphics: appSettingsSchema.optional(),
	})
	.strip();

/** Synchronous loading is required before Electron initializes its GPU process. */
export class AppSettingsStore {
	readonly #path: string;
	readonly #platform: NodeJS.Platform;
	readonly #defaults: AppSettings;
	#settings: AppSettings;
	#diagnostic: string | null = null;
	#preserveUnreadable = false;
	#pending: Promise<void> = Promise.resolve();
	#lastWrite: Promise<void> = Promise.resolve();

	constructor(path: string, platform: NodeJS.Platform) {
		this.#path = path;
		this.#platform = platform;
		this.#defaults = defaultAppSettings(platform);
		this.#settings = { ...this.#defaults };
		try {
			const { graphics } = savedAppSettingsSchema.parse(
				JSON.parse(readFileSync(path, "utf8")),
			);
			if (graphics !== undefined) this.#settings = this.#validate(graphics);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return;
			this.#diagnostic = `App settings could not be loaded. Using platform defaults. Saving will preserve the original file. ${formatError(error)}`;
			this.#preserveUnreadable = true;
		}
	}
	get settings(): AppSettings {
		return {
			...this.#settings,
			liveApi: { ...this.#settings.liveApi },
		};
	}
	get defaults(): AppSettings {
		return {
			...this.#defaults,
			liveApi: { ...this.#defaults.liveApi },
		};
	}
	get diagnostic(): string | null {
		return this.#diagnostic;
	}
	#validate(input: unknown): AppSettings {
		const settings = appSettingsSchema.parse(input);
		if (
			!graphicsBackendOptions(this.#platform).some(
				({ value }) => value === settings.graphicsBackend,
			)
		)
			throw new Error("Graphics backend is unavailable on this platform");
		return settings;
	}
	/** Acknowledges durable replacement; errors reach the modal and leave the prior choice intact. */
	save(input: unknown): Promise<void> {
		const settings = this.#validate(input);
		const operation = this.#pending.then(async () => {
			if (this.#preserveUnreadable) {
				await copyFile(
					this.#path,
					`${this.#path}.invalid-${randomUUID()}`,
					constants.COPYFILE_EXCL,
				);
				this.#preserveUnreadable = false;
			}
			await replaceLocalFile(
				this.#path,
				// Canonical saves drop retired sections on every platform.
				JSON.stringify({ version: 1, graphics: settings }, null, 2) + "\n",
			);
			this.#settings = settings;
			this.#diagnostic = null;
		});
		// Callers observe failures; subsequent saves remain available for retry.
		this.#pending = operation.catch(() => undefined);
		this.#lastWrite = operation;
		return operation;
	}
	/** Native shutdown joins the last admitted save, including a failed replacement. */
	flush(): Promise<void> {
		return this.#lastWrite;
	}
}
