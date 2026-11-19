import { z } from "zod";

/** Process-wide graphics preferences, independent of servers and characters. */
export const appSettingsSchema = z
	.object({
		/** Automatic delegates backend selection to Chromium. */
		graphicsBackend: z.enum(["automatic", "d3d11", "gl", "metal"]),
		/** Request GPU synchronization; the OS compositor still owns final presentation. */
		vsync: z.boolean(),
		/** Use the GPU to composite browser UI surfaces; independent of WebGL rendering. */
		gpuCompositing: z.boolean(),
	})
	.strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Host-provided choices prevent offering another platform's graphics API. */
export interface GraphicsBackendOption {
	/** Persisted Chromium backend selection. */
	readonly value: AppSettings["graphicsBackend"];
	/** Platform-appropriate display name. */
	readonly label: string;
}

/** Launcher projection of saved preferences and current process diagnostics. */
export interface AppSettingsSnapshot {
	/** Durable preferences used to seed a local modal draft. */
	readonly settings: AppSettings;
	/** Native platform defaults shared by first launch, recovery, and the reset button. */
	readonly defaults: AppSettings;
	/** Choices accepted by this native host. */
	readonly backends: readonly GraphicsBackendOption[];
	/** Native owner compares saved preferences with those used at process startup. */
	readonly restartRequired: boolean;
	/** Explicit launch overrides take precedence over saved preferences. */
	readonly overrides: readonly string[];
	/** Actual ANGLE renderer string, including GPU/backend, when reported by Chromium. */
	readonly renderer: string | null;
	/** Electron's current acceleration-enabled status, separate from the renderer identity. */
	readonly hardwareAcceleration: boolean;
	/** Failed GPU queries or unreadable preferences remain visible in the modal. */
	readonly diagnostic: string | null;
}
