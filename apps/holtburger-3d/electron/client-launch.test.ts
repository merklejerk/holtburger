import { describe, expect, it } from "vitest";
import {
	electronApplicationArguments,
	parseClientLaunchArguments,
} from "./client-launch";

describe("Electron application arguments", () => {
	it("removes the development app path but retains the first packaged argument", () => {
		expect(
			electronApplicationArguments(
				["/electron", "/app", "client", "--account=ash"],
				true,
			),
		).toEqual(["client", "--account=ash"]);
		expect(
			electronApplicationArguments(
				["/holtburger-3d", "client", "--account=ash"],
				false,
			),
		).toEqual(["client", "--account=ash"]);
	});
});

describe("parseClientLaunchArguments", () => {
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
