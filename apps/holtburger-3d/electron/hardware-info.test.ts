import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyHardwareInfo } from "./hardware-info";

const native = vi.hoisted(() => ({
	writeText: vi.fn(),
	getGPUInfo: vi.fn(),
	getSwitchValue: vi.fn((name: string): string =>
		name === "use-angle" ? "d3d11" : "private-launch-argument",
	),
}));
vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getGPUInfo: native.getGPUInfo,
		getGPUFeatureStatus: () => ({
			webgl: "enabled",
			webgl2: "enabled",
			gpu_compositing: "enabled",
		}),
		isHardwareAccelerationEnabled: () => true,
		commandLine: {
			hasSwitch: (name: string) =>
				["use-angle", "password", "log-file"].includes(name),
			getSwitchValue: native.getSwitchValue,
		},
	},
	clipboard: { writeText: native.writeText },
	screen: {
		getDisplayMatching: () => ({
			size: { width: 1920, height: 1080 },
			scaleFactor: 1.5,
			displayFrequency: 60,
			colorDepth: 24,
			colorSpace: "sRGB",
			label: "private-display-label",
			id: "private-display-id",
		}),
	},
}));

/** Only the two window measurements consumed by the report need a test implementation. */
const window = {
	getBounds: () => ({ x: 0, y: 0, width: 900, height: 650 }),
	getContentSize: () => [900, 650],
};
const startup = {
	graphicsBackend: "automatic",
	vsync: true,
	gpuCompositing: true,
} as const;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("hardware clipboard report", () => {
	it("omits path-like values even on an approved graphics switch", async () => {
		native.getGPUInfo.mockResolvedValue({ gpuDevice: [] });
		native.getSwitchValue.mockReturnValueOnce("/home/private-user/driver");
		await copyHardwareInfo(
			window,
			{ build: "test", webgl: null },
			startup,
			startup,
			[],
		);
		const report: string = native.writeText.mock.calls[0][0];
		expect(report).toContain("Unrecognized value (omitted)");
		expect(report).not.toContain("private-user");
	});
	it("exports selected evidence while excluding unrelated native fields and launch arguments", async () => {
		native.getGPUInfo.mockResolvedValue({
			gpuDevice: [
				{
					active: true,
					vendorId: 1234,
					deviceId: 5678,
					driverVersion: "test-driver",
					deviceString: "test-gpu",
					devicePath: "private-device-path",
				},
			],
			auxAttributes: {
				glRenderer: "test-renderer",
				machinePath: "private-machine-path",
			},
			machineModelName: "private-machine-name",
		});
		await copyHardwareInfo(
			window,
			{ build: "v-test revision", webgl: null },
			startup,
			{ graphicsBackend: "gl", vsync: false, gpuCompositing: true },
			["--use-angle"],
		);
		const report: string = native.writeText.mock.calls[0][0];
		expect(JSON.parse(report)).toMatchObject({
			application: { build: "v-test revision" },
			graphicsSettings: { restartRequired: true },
			display: { refreshHz: 60 },
		});
		expect(report).toContain('"driverVersion": "test-driver"');
		expect(report).toContain('"refreshHz": 60');
		expect(report).toContain('"restartRequired": true');
		expect(report).toContain('"use-angle": "d3d11"');
		expect(report).toContain("Unavailable: WebGL2 context creation failed");
		expect(report).not.toContain("private-");
		expect(native.getSwitchValue).toHaveBeenCalledExactlyOnceWith("use-angle");
	});
	it("records GPU query failure without copying raw errors or preventing the rest of the report", async () => {
		native.getGPUInfo.mockRejectedValue(new Error("private-driver-path"));
		const errorLog = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		try {
			await copyHardwareInfo(
				window,
				{ build: "test", webgl: null },
				startup,
				startup,
				[],
			);
			const report: string = native.writeText.mock.calls[0][0];
			expect(report).toContain(
				"Unavailable: native GPU information query failed",
			);
			expect(JSON.parse(report)).toHaveProperty("system");
			expect(report).not.toContain("private-driver-path");
		} finally {
			errorLog.mockRestore();
		}
	});
});
