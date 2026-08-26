import { describe, expect, it } from "vitest";

import {
	extractVitePortArguments,
	stripClientLaunchArguments,
} from "./entry-paths.mjs";
import { parseVitePort, resolveVitePort } from "./dev-port.mjs";

describe("development launcher arguments", () => {
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
