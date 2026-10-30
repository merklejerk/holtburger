import { describe, expect, it, vi } from "vitest";
import {
	ServerDirectoryCatalog,
	TREE_STATS_DIRECTORY_URL,
} from "./server-directory";

const row = {
	name: "Community",
	description: "End of retail",
	type: "PvE",
	software: "ACE",
	host: "play.example.org",
	port: "9000",
	players: {
		count: 42,
		updated_at: "2026-10-24 21:50:31 UTC",
		age: "4 days ago",
	},
};
function setup(rows: unknown) {
	const request = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => new Response(JSON.stringify(rows)));
	return { request, catalog: new ServerDirectoryCatalog(request) };
}
describe("TreeStats server directory", () => {
	it("normalizes the live schema and derives saved-endpoint membership without importing credentials", async () => {
		const { catalog, request } = setup([row]);
		await catalog.load(false);
		expect(request).toHaveBeenCalledWith(
			TREE_STATS_DIRECTORY_URL,
			expect.objectContaining({
				credentials: "omit",
				signal: expect.any(AbortSignal),
			}),
		);
		const saved = {
			id: "existing",
			name: "My label",
			endpoint: { host: "PLAY.EXAMPLE.ORG", port: 9000 },
		};
		expect(catalog.view([saved])).toEqual({
			unavailableEntries: 0,
			servers: [
				{
					key: "play.example.org:9000",
					name: "Community",
					description: "End of retail",
					kind: "PvE",
					software: "ACE",
					endpoint: { host: "play.example.org", port: 9000 },
					alreadyAdded: true,
					players: { count: 42, updatedAt: row.players.updated_at },
				},
			],
		});
		expect(catalog.select("play.example.org:9000")).toEqual({
			name: "Community",
			endpoint: { host: "play.example.org", port: 9000 },
		});
		expect(catalog.view([]).servers[0]?.alreadyAdded).toBe(false);
	});
	it("omits invalid/duplicate rows explicitly and keeps entries without player reports", async () => {
		const { catalog } = setup([
			{ ...row, players: undefined },
			{ ...row, host: "PLAY.EXAMPLE.ORG" },
			{ ...row, port: "9000junk" },
			{ ...row, port: 65536 },
			{ ...row, host: "" },
		]);
		await catalog.load(false);
		expect(catalog.view([])).toMatchObject({
			unavailableEntries: 4,
			servers: [{ players: null }],
		});
	});
	it("caches successful reads, joins overlapping loads, and refreshes only on request", async () => {
		const { catalog, request } = setup([row]);
		await Promise.all([catalog.load(false), catalog.load(true)]);
		await catalog.load(false);
		expect(request).toHaveBeenCalledTimes(1);
		request.mockResolvedValue(
			new Response(JSON.stringify([{ ...row, host: "changed.example.org" }])),
		);
		await catalog.load(true);
		expect(request).toHaveBeenCalledTimes(2);
		expect(() => catalog.select("play.example.org:9000")).toThrow(
			"no longer in",
		);
	});
	it("retains the previous snapshot after a failed refresh and allows a subsequent retry", async () => {
		const { catalog, request } = setup([row]);
		await catalog.load(false);
		request.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		await expect(catalog.load(true)).rejects.toThrow("HTTP 503");
		expect(catalog.view([]).servers).toHaveLength(1);
		await catalog.load(true);
		expect(request).toHaveBeenCalledTimes(3);
	});
	it("surfaces transport failures and rejects unusable responses and unknown selections", async () => {
		const { catalog, request } = setup({ error: "unexpected envelope" });
		expect(() => catalog.view([])).toThrow("Load the TreeStats");
		await expect(catalog.load(false)).rejects.toThrow();
		request.mockRejectedValueOnce(new Error("Network unavailable"));
		await expect(catalog.load(false)).rejects.toThrow("Network unavailable");
		request.mockResolvedValueOnce(
			new Response(JSON.stringify([{ ...row, port: "bad" }])),
		);
		await expect(catalog.load(false)).rejects.toThrow(
			"no usable server entries",
		);
		request.mockResolvedValueOnce(new Response("[]"));
		await catalog.load(false);
		expect(catalog.view([]).servers).toEqual([]);
		expect(() => catalog.select([])).toThrow();
		expect(() => catalog.select("unlisted:9000")).toThrow("no longer in");
	});
});
