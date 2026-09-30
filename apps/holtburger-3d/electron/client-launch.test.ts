import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
	electronApplicationArguments,
	parseClientLaunchArguments,
} from "./client-launch";

describe("Electron application arguments", () => {
	it("removes the development app path and leading Electron switches", () => {
		expect(
			electronApplicationArguments(
				[
					"/electron",
					"--remote-debugging-port=0",
					"/app",
					"client",
					"--account=ash",
				],
				true,
				"/app",
			),
		).toEqual(["client", "--account=ash"]);
		expect(
			electronApplicationArguments(
				["/holtburger-3d", "client", "--account=ash"],
				false,
				"/app",
			),
		).toEqual(["client", "--account=ash"]);
		expect(() =>
			electronApplicationArguments(["/electron", "client"], true, "/app"),
		).toThrow("development application path is missing");
	});
});

describe("parseClientLaunchArguments", () => {
	it("resolves direct-launch settings paths from Electron's working directory", () => {
		const settingsFile = resolve("settings.json");
		expect(
			parseClientLaunchArguments([
				"--account=ash",
				"--settings-file",
				settingsFile,
			]),
		).toMatchObject({ settingsFile, rendererArguments: [] });
		expect(
			parseClientLaunchArguments([
				"--account=ash",
				"--settings-file=relative.json",
			]),
		).toMatchObject({ settingsFile: resolve("relative.json") });
		expect(() =>
			parseClientLaunchArguments(["--account=ash", "--settings-file="]),
		).toThrow("cannot be empty");
	});
	it("resolves a server endpoint and keeps only non-credential args for the entry", () => {
		expect(
			parseClientLaunchArguments([
				"--server",
				"world.example:9001",
				"--account=ash",
				"--password",
				"secret",
				"--query=landblock=0x7fffff",
			]),
		).toEqual({
			startup: {
				host: "world.example",
				port: 9001,
				account: "ash",
				password: "secret",
			},
			ignorePersistedConfig: false,
			settingsFile: null,
			rendererArguments: ["--query=landblock=0x7fffff"],
		});
	});

	it("uses explicit host and port when server is absent", () => {
		expect(
			parseClientLaunchArguments([
				"--host",
				"localhost",
				"--port",
				"9010",
				"--account",
				"ash",
			]),
		).toEqual({
			startup: {
				host: "localhost",
				port: 9010,
				account: "ash",
				password: "",
			},
			ignorePersistedConfig: false,
			settingsFile: null,
			rendererArguments: [],
		});
	});

	it("gives server precedence over separate host and port", () => {
		expect(
			parseClientLaunchArguments([
				"--server=world.example",
				"--host=ignored.example",
				"--port=9010",
				"--account=ash",
			]),
		).toMatchObject({ startup: { host: "world.example", port: 9010 } });
	});

	it("rejects missing accounts and malformed embedded ports", () => {
		expect(() => parseClientLaunchArguments([])).toThrow(/requires --account/);
		expect(() =>
			parseClientLaunchArguments([
				"--account=ash",
				"--server=world.example:nope",
			]),
		).toThrow(/invalid port/);
	});

	it("rejects duplicate launch flags before startup", () => {
		expect(() =>
			parseClientLaunchArguments(["--account=ash", "--account=other"]),
		).toThrow(/specified more than once/);
	});

	it("accepts a finite positive melee chase override", () => {
		expect(
			parseClientLaunchArguments([
				"--account=ash",
				"--melee-max-chase-distance=24.5",
			]),
		).toMatchObject({ startup: { meleeMaxChaseDistance: 24.5 } });
		for (const invalid of ["0", "-1", "nope", "Infinity"]) {
			expect(() =>
				parseClientLaunchArguments([
					"--account=ash",
					`--melee-max-chase-distance=${invalid}`,
				]),
			).toThrow(/finite positive/);
		}
	});

	it("accepts the bare config bypass and rejects values", () => {
		expect(
			parseClientLaunchArguments(["--account=ash", "--ignore-config"]),
		).toMatchObject({ ignorePersistedConfig: true });
		expect(() =>
			parseClientLaunchArguments(["--account=ash", "--ignore-config=true"]),
		).toThrow(/does not accept a value/);
	});

	it("maps every one-character client option to its canonical field", () => {
		expect(
			parseClientLaunchArguments([
				"-h",
				"localhost",
				"-P=9010",
				"-a",
				"ash",
				"-p=secret",
				"-i",
			]),
		).toEqual({
			startup: {
				host: "localhost",
				port: 9010,
				account: "ash",
				password: "secret",
			},
			ignorePersistedConfig: true,
			settingsFile: null,
			rendererArguments: [],
		});
		expect(
			parseClientLaunchArguments(["-s", "world.example:9001", "-a", "ash"]),
		).toMatchObject({
			startup: { host: "world.example", port: 9001 },
		});
	});

	it("detects duplicates across long and abbreviated spellings", () => {
		expect(() =>
			parseClientLaunchArguments(["--account=ash", "-a", "other"]),
		).toThrow(/specified more than once/);
	});
});
