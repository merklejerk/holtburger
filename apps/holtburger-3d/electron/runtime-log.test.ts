import { expect, it } from "vitest";
import { RuntimeLog } from "./runtime-log";

it("coalesces repeats and only returns a new snapshot after changes", () => {
	const log = new RuntimeLog();
	log.record("warning", "One visual was refused");
	const first = log.read(-1);
	if (first === null) throw new Error("Expected a runtime log snapshot.");
	expect(log.read(first.revision)).toBeNull();

	log.record("warning", "One visual was refused");
	log.record("error", "One visual was refused");
	expect(log.read(first.revision)?.entries).toMatchObject([
		{ level: "warning", count: 2 },
		{ level: "error", count: 1 },
	]);
	expect(first.entries[0]?.count).toBe(1);
	log.clear();
	expect(log.read(first.revision)?.entries).toEqual([]);
});

it("evicts old messages when a burst exceeds the memory budget", () => {
	const log = new RuntimeLog();
	log.record("warning", "old");
	for (let index = 0; index < 100; index++)
		log.record("warning", `${index}:${"λ".repeat(4000)}`);
	log.record("error", "latest");
	const entries = log.read(-1)?.entries ?? [];
	expect(entries.at(-1)?.message).toBe("latest");
	expect(entries.some(({ message }) => message === "old")).toBe(false);
	expect(
		entries.reduce((sum, { message }) => sum + Buffer.byteLength(message), 0),
	).toBeLessThanOrEqual(64 * 1024);
});
