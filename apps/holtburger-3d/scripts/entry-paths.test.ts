import { describe, expect, it } from "vitest";

import {
	extractContentArguments,
	extractEntryArguments,
	buildEntryPath,
	collapseRendererArguments,
	extractElectronLaunchArguments,
	extractVitePortArguments,
	partitionClientLaunchArguments,
	stripClientLaunchArguments,
} from "./entry-paths.mjs";
import { parseVitePort, resolveVitePort } from "./dev-port.mjs";
import { clientDebugEnabled } from "../src/client/client-debug";
import { resolve } from "node:path";

describe("desktop entry selection", () => {
	it.each([[], ["--account=ash"], ["-a", "ash", "-p", "9000", "-P", "secret"]])(
		"defaults to client without consuming connection flags: %j",
		(...args) => {
			expect(extractEntryArguments(args)).toEqual({ name: "client", args });
		},
	);
	it.each(["client", "explorer"])("accepts explicit %s", (name) => {
		expect(extractEntryArguments([name, "--debug"])).toEqual({
			name,
			args: ["--debug"],
		});
	});
	it("rejects an unknown positional entry", () => {
		expect(() => extractEntryArguments(["unknown"])).toThrow(
			"Unknown application entry",
		);
	});
});

describe("shared content arguments", () => {
	it("consumes independent desktop controls before the entry and leaves explicit content intact", () => {
		expect(
			extractContentArguments(
				[
					"--no-content-search",
					"client",
					"--clear-content",
					"--content=AC data",
					"--debug",
				],
				"/invocation",
			),
		).toEqual({
			contentPath: resolve("/invocation", "AC data"),
			noContentSearch: true,
			clearContent: true,
			args: ["client", "--debug"],
		});
	});
	it.each(["--no-content-search", "--clear-content"])(
		"rejects values and duplicates for %s",
		(flag) => {
			expect(() =>
				extractContentArguments([`${flag}=false`], "/invocation"),
			).toThrow("does not take a value");
			expect(() =>
				extractContentArguments([flag, flag], "/invocation"),
			).toThrow("more than once");
		},
	);

	it.each(["client", "explorer"])(
		"keeps %s content paths out of renderer arguments",
		(entry) => {
			const result = extractContentArguments(
				[entry, "--content", "AC data", "--debug"],
				"/invocation",
			);
			expect(result).toEqual({
				contentPath: resolve("/invocation", "AC data"),
				noContentSearch: false,
				clearContent: false,
				args: [entry, "--debug"],
			});
			expect(buildEntryPath("index.html", result.args.slice(1))).toBe(
				"index.html?debug=true",
			);
		},
	);
	it("consumes an override before an optional entry name", () => {
		expect(
			extractContentArguments(["--content=AC data"], "/invocation"),
		).toEqual({
			contentPath: resolve("/invocation", "AC data"),
			noContentSearch: false,
			clearContent: false,
			args: [],
		});
	});
	it.each([
		["--content"],
		["--content="],
		["--content", "--debug"],
		["--content=a", "--content=b"],
	])("rejects invalid content selection: %j", (...args) => {
		expect(() => extractContentArguments(args, "/invocation")).toThrow(
			"--content",
		);
	});
});

describe("development launcher arguments", () => {
	it.each([[], ["--debug=false"]])(
		"leaves DevTools closed without an opt-in: %j",
		(...args) => {
			expect(extractElectronLaunchArguments(args)).toEqual({
				args,
				electronSwitches: [],
			});
		},
	);

	it.each(["--debug", "--debug=true"])(
		"opens the default DevTools port for %s and preserves renderer diagnostics",
		(flag) => {
			expect(extractElectronLaunchArguments([flag])).toEqual({
				args: [flag],
				electronSwitches: ["--remote-debugging-port=9222"],
			});
		},
	);

	it.each([
		["--debug", "--debug-port", "9223"],
		["--debug-port=9223", "--debug"],
	])(
		"overrides the debug port without leaking it into the renderer: %j",
		(...args) => {
			expect(extractElectronLaunchArguments(args)).toEqual({
				args: ["--debug"],
				electronSwitches: ["--remote-debugging-port=9223"],
			});
		},
	);

	it("allows an assigned DevTools port without renderer instrumentation", () => {
		expect(
			extractElectronLaunchArguments(["--debug=false", "--debug-port=0"]),
		).toEqual({
			args: ["--debug=false"],
			electronSwitches: ["--remote-debugging-port=0"],
		});
	});

	it.each([
		["--debug=false", "--debug"],
		["--debug", "--debug=false"],
		["--query=debug=false", "--debug"],
		["--query=debug=true"],
	])("matches the renderer's effective diagnostics query: %j", (...args) => {
		const launch = extractElectronLaunchArguments(args);
		const search = buildEntryPath("", launch.args);
		expect(launch.electronSwitches.length > 0).toBe(clientDebugEnabled(search));
	});

	it("partitions client arguments before interpreting renderer and shell flags", () => {
		const partitioned = partitionClientLaunchArguments([
			"--account",
			"ash",
			"--debug-port",
			"0",
			"--debug",
		]);
		const launch = extractElectronLaunchArguments(
			partitioned.rendererArguments,
		);
		expect(partitioned.launchArguments).toEqual(["--account", "ash"]);
		expect(collapseRendererArguments(launch.args)).toEqual([
			"--query=debug=true",
		]);
		expect(launch.electronSwitches).toEqual(["--remote-debugging-port=0"]);
	});

	it.each(["", "-1", "1.5", "65536", "NaN", "01"])(
		"rejects invalid debug port %j",
		(value) => {
			expect(() =>
				extractElectronLaunchArguments([`--debug-port=${value}`]),
			).toThrow("--debug-port must be an integer from 0 to 65535.");
		},
	);

	it("rejects missing and duplicate debug port values", () => {
		for (const args of [["--debug-port"], ["--debug-port", "--debug"]]) {
			expect(() => extractElectronLaunchArguments(args)).toThrow(
				"--debug-port requires a value.",
			);
		}
		expect(() =>
			extractElectronLaunchArguments(["--debug-port=0", "--debug-port=9223"]),
		).toThrow("Debug port was specified more than once.");
	});

	it("combines debug and uncapped switches without consuming renderer flags", () => {
		expect(
			extractElectronLaunchArguments([
				"--debug",
				"--uncapped",
				"--landblock=0x7fffff",
			]),
		).toEqual({
			args: ["--debug", "--landblock=0x7fffff"],
			electronSwitches: [
				"--disable-frame-rate-limit",
				"--disable-gpu-vsync",
				"--remote-debugging-port=9222",
			],
		});
	});

	it("forwards world-map cache bypass to main without putting it in the renderer URL", () => {
		expect(
			partitionClientLaunchArguments(["--ignore-world-map-cache", "--debug"]),
		).toEqual({
			launchArguments: ["--ignore-world-map-cache"],
			rendererArguments: ["--debug"],
		});
		expect(() =>
			partitionClientLaunchArguments(["--ignore-world-map-cache=true"]),
		).toThrow("does not accept a value");
	});

	it("turns the bare client debug flag into an explicit renderer value", () => {
		expect(buildEntryPath("client/index.html", ["--debug"])).toBe(
			"client/index.html?debug=true",
		);
		expect(collapseRendererArguments(["--debug"])).toEqual([
			"--query=debug=true",
		]);
	});

	it("keeps renderer flags out of Electron's application arguments", () => {
		expect(
			partitionClientLaunchArguments([
				"--account",
				"ash",
				"--password=secret",
				"--debug",
			]),
		).toEqual({
			launchArguments: ["--account", "ash", "--password=secret"],
			rendererArguments: ["--debug"],
		});
	});

	it("forwards the config bypass as a valueless main-process flag", () => {
		expect(
			partitionClientLaunchArguments([
				"--account=ash",
				"--ignore-config",
				"--debug",
			]),
		).toEqual({
			launchArguments: ["--account=ash", "--ignore-config"],
			rendererArguments: ["--debug"],
		});
		expect(() =>
			partitionClientLaunchArguments(["--account=ash", "--ignore-config=true"]),
		).toThrow(/does not accept a value/);
	});

	it("keeps the settings-file path out of the renderer URL", () => {
		expect(
			partitionClientLaunchArguments([
				"--account=ash",
				"--settings-file",
				"/tmp/settings.json",
				"--debug",
			]),
		).toEqual({
			launchArguments: [
				"--account=ash",
				"--settings-file",
				"/tmp/settings.json",
			],
			rendererArguments: ["--debug"],
		});
	});

	it("resolves separated and inline settings paths from the invoking directory", () => {
		const invokingDirectory = "/workspace/apps/holtburger-3d";
		for (const settingsFlag of [
			["--settings-file", "../../.holtburger-local/settings.json"],
			["--settings-file=../../.holtburger-local/settings.json"],
		]) {
			expect(
				partitionClientLaunchArguments(
					["--account=ash", ...settingsFlag, "--debug"],
					invokingDirectory,
				),
			).toEqual({
				launchArguments: [
					"--account=ash",
					"--settings-file",
					"/workspace/.holtburger-local/settings.json",
				],
				rendererArguments: ["--debug"],
			});
		}
		expect(() =>
			partitionClientLaunchArguments(
				["--account=ash", "--settings-file="],
				invokingDirectory,
			),
		).toThrow("cannot be empty");
	});

	it("keeps abbreviated client options in Electron main", () => {
		expect(
			partitionClientLaunchArguments([
				"-s=world.example:9001",
				"-h",
				"localhost",
				"-p",
				"9010",
				"-a=ash",
				"-P",
				"secret",
				"-i",
				"--debug",
			]),
		).toEqual({
			launchArguments: [
				"-s=world.example:9001",
				"-h",
				"localhost",
				"-p",
				"9010",
				"-a=ash",
				"-P",
				"secret",
				"-i",
			],
			rendererArguments: ["--debug"],
		});
	});

	it("accepts separated client values without putting credentials in the renderer URL", () => {
		expect(
			stripClientLaunchArguments([
				"--server",
				"world.example:9001",
				"--account",
				"ash",
				"--password=secret",
				"--query=landblock=0x7fffff",
			]),
		).toEqual(["--query=landblock=0x7fffff"]);
	});

	it("extracts an explicit Vite port in either spelling", () => {
		expect(
			extractVitePortArguments(["--vite-port", "1432", "--query=scene"]),
		).toEqual({ args: ["--query=scene"], vitePort: "1432" });
		expect(
			extractVitePortArguments(["--vite-port=1433", "--query=scene"]),
		).toEqual({ args: ["--query=scene"], vitePort: "1433" });
	});

	it("keeps client --port available for the ACE endpoint", () => {
		expect(
			extractVitePortArguments(["--port", "9000", "--account", "ash"]),
		).toEqual({
			args: ["--port", "9000", "--account", "ash"],
			vitePort: undefined,
		});
	});

	it("allows --port as a Vite-only wrapper alias", () => {
		expect(
			extractVitePortArguments(["--port=1432", "--query=scene"], {
				allowPortAlias: true,
			}),
		).toEqual({ args: ["--query=scene"], vitePort: "1432" });
	});

	it("rejects malformed or duplicate Vite port arguments", () => {
		expect(() =>
			extractVitePortArguments(["--vite-port", "--query=scene"]),
		).toThrow(/requires a value/);
		expect(() =>
			extractVitePortArguments(["--vite-port=1432", "--vite-port", "1433"]),
		).toThrow(/more than once/);
		expect(() => parseVitePort("65536")).toThrow(/0 to 65535/);
	});

	it("keeps zero as the random-port sentinel and honors an explicit port", async () => {
		expect(parseVitePort("0")).toBe(0);
		await expect(resolveVitePort("1432", "0")).resolves.toBe(1432);
	});
});
