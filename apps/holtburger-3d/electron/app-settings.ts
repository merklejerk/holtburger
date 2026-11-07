import { constants, readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	appSettingsSchema,
	type AppSettings,
	type GraphicsBackendOption,
} from "../src/app/app-settings-contract.js";
import { formatError } from "../src/lib/format-error.js";
import { replaceLocalFile } from "./replace-local-file.js";

/** Windows defaults address FPS, scrolling, and intermittent missing UI patches. */
function defaultAppSettings(platform: NodeJS.Platform): AppSettings {
	return platform === "win32"
		? { graphicsBackend: "gl", vsync: false, gpuCompositing: false }
		: { graphicsBackend: "automatic", vsync: true, gpuCompositing: true };
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
interface GraphicsCommandLine {
	hasSwitch(name: string): boolean;
	appendSwitch(name: string, value?: string): void;
	removeSwitch(name: string): void;
}

/** Configure synchronously before ready; explicit diagnostic launch arguments win. */
export function applyAppGraphicsSettings(
	settings: AppSettings,
	commandLine: GraphicsCommandLine,
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

const savedAppSettingsSchema = z
	.object({
		version: z.literal(1),
		// Earlier version-1 files predate this preference; resolve it at the native load boundary.
		settings: appSettingsSchema.extend({
			gpuCompositing: z.boolean().optional(),
		}),
	})
	.strict();

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
			const { settings } = savedAppSettingsSchema.parse(
				JSON.parse(readFileSync(path, "utf8")),
			);
			this.#settings = this.#validate({
				...settings,
				gpuCompositing:
					settings.gpuCompositing ?? this.#defaults.gpuCompositing,
			});
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return;
			this.#diagnostic = `App settings could not be loaded. Using platform defaults. Saving will preserve the original file. ${formatError(error)}`;
			this.#preserveUnreadable = true;
		}
	}
	get settings(): AppSettings {
		return { ...this.#settings };
	}
	get defaults(): AppSettings {
		return { ...this.#defaults };
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
				JSON.stringify({ version: 1, settings }, null, 2) + "\n",
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
