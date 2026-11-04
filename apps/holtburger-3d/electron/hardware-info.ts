import { cpus, machine, release, totalmem, type, version } from "node:os";
import { app, clipboard, screen, type BrowserWindow } from "electron";
import { z } from "zod";
import { hardwareInfoRequestSchema } from "../src/app/hardware-info-contract.js";
import type { AppSettings } from "../src/app/app-settings-contract.js";
import { appSettingsRequireRestart } from "./app-settings.js";

/** Select known diagnostic fields; Chromium may also expose paths and machine-specific data. */
const gpuInfoSchema = z.object({
	gpuDevice: z.array(
		z.object({
			active: z.boolean().optional(),
			vendorId: z.number().optional(),
			deviceId: z.number().optional(),
			vendorString: z.string().optional(),
			deviceString: z.string().optional(),
			driverVendor: z.string().optional(),
			driverVersion: z.string().optional(),
		}),
	),
	auxAttributes: z
		.object({
			glRenderer: z.string().optional(),
			glVendor: z.string().optional(),
			glVersion: z.string().optional(),
			glImplementationParts: z.string().optional(),
			skiaBackendType: z.string().optional(),
			softwareRendering: z.boolean().optional(),
		})
		.optional(),
});

/** Only approved graphics switches are exported, never connection arguments or raw argv. */
const GRAPHICS_SWITCHES = [
	"use-angle",
	"use-gl",
	"ozone-platform",
	"enable-vsync",
	"disable-gpu-vsync",
	"disable-frame-rate-limit",
	"force-high-performance-gpu",
	"disable-gpu",
	"disable-gpu-compositing",
	"ignore-gpu-blocklist",
] as const;

/** Clipboard collection uses current native state, independently of an unsaved modal draft. */
export async function copyHardwareInfo(
	window: Pick<BrowserWindow, "getBounds" | "getContentSize">,
	input: unknown,
	startup: AppSettings,
	saved: AppSettings,
	overrides: readonly string[],
): Promise<void> {
	const request = hardwareInfoRequestSchema.parse(input);
	let gpu: z.infer<typeof gpuInfoSchema> | string;
	try {
		gpu = gpuInfoSchema.parse(await app.getGPUInfo("complete"));
	} catch (error) {
		console.error("Hardware report GPU query failed", error);
		// Raw errors may contain local paths; the report still records the missing evidence.
		gpu = "Unavailable: native GPU information query failed";
	}
	const processors = cpus();
	const display = screen.getDisplayMatching(window.getBounds());
	const [width, height] = window.getContentSize();
	const features = app.getGPUFeatureStatus();
	const report = {
		application: {
			build: request.build,
			packaged: app.isPackaged,
			electron: process.versions.electron,
			chromium: process.versions.chrome,
			node: process.versions.node,
		},
		system: {
			os: type(),
			release: release(),
			version: version(),
			systemArchitecture: machine(),
			processArchitecture: process.arch,
			cpuModels: [...new Set(processors.map(({ model }) => model))],
			logicalCpus: processors.length,
			totalMemoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
		},
		environment: {
			session:
				z
					.enum(["x11", "wayland", "tty"])
					.safeParse(process.env.XDG_SESSION_TYPE).data ?? "Not reported",
			flatpak: process.env.FLATPAK_ID !== undefined,
		},
		display: {
			sizeDip: display.size,
			scaleFactor: display.scaleFactor,
			refreshHz: display.displayFrequency,
			colorDepth: display.colorDepth,
			colorSpace: display.colorSpace,
			windowContentDip: { width, height },
		},
		graphicsSettings: {
			startup,
			saved,
			restartRequired: appSettingsRequireRestart(startup, saved),
			launchOverrides: overrides,
			effectiveSwitches: Object.fromEntries(
				GRAPHICS_SWITCHES.filter((name) => app.commandLine.hasSwitch(name)).map(
					(name) => {
						const value = app.commandLine.getSwitchValue(name);
						// These switches take backend names or no value. Never copy path-like arguments.
						return [
							name,
							/^[a-z0-9_-]{0,64}$/i.test(value)
								? value
								: "Unrecognized value (omitted)",
						];
					},
				),
			),
		},
		chromiumGraphics: {
			accelerationEnabled: app.isHardwareAccelerationEnabled(),
			features: {
				webgl: features.webgl ?? "Not reported",
				webgl2: features.webgl2 ?? "Not reported",
				compositing: features.gpu_compositing ?? "Not reported",
				rasterization: features.rasterization ?? "Not reported",
			},
			gpu,
		},
		launcherWebgl2Probe:
			request.webgl ?? "Unavailable: WebGL2 context creation failed",
	};
	clipboard.writeText(JSON.stringify(report, null, 2) + "\n");
}
