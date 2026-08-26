import { describe, expect, it } from "vitest";
import { parseClientLaunchArguments } from "./client-launch";

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
});
