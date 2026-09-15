import { describe, expect, it, vi } from "vitest";
import { MAX_SPELL_REFERENCE_BATCH, SpellReferences } from "./spell-references";

describe("SpellReferences", () => {
	it.each([
		{ reply: [], detail: "count" },
		{
			reply: [
				{ kind: "missing", id: 1 },
				{ kind: "missing", id: 1 },
			],
			detail: "Duplicate",
		},
	])(
		"diagnoses malformed response $detail without omitting requested rows",
		async ({ reply, detail }) => {
			const source = new SpellReferences({
				invoke: vi.fn().mockResolvedValue(reply),
			});
			expect(await source.load([1, 2])).toEqual(
				[1, 2].map((id) => ({
					kind: "failed",
					id,
					detail: expect.stringContaining(detail),
				})),
			);
		},
	);
	it("coalesces identities across independent consumers and bounds batches", async () => {
		const invoke = vi.fn(async (_command, args) => {
			const ids = args.request.spellIds as number[];
			return ids.map((id) => ({ kind: "missing", id }));
		});
		const source = new SpellReferences({ invoke });
		const ids = Array.from(
			{ length: MAX_SPELL_REFERENCE_BATCH + 1 },
			(_, i) => i + 1,
		);
		const first = source.load(ids);
		const second = source.load([1]);
		expect(await first).toHaveLength(ids.length);
		expect(await second).toEqual([{ kind: "missing", id: 1 }]);
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(invoke.mock.calls[0][1].request.spellIds).toHaveLength(
			MAX_SPELL_REFERENCE_BATCH,
		);
		await source.load(ids);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("reports malformed replies per identity and continues subsequent batches", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce([{ kind: "missing", id: 3 }])
			.mockResolvedValueOnce([{ kind: "missing", id: 2 }]);
		const source = new SpellReferences({ invoke });
		expect(await source.load([1])).toEqual([
			{ kind: "failed", id: 1, detail: expect.stringContaining("Unexpected") },
		]);
		expect(await source.load([2])).toEqual([{ kind: "missing", id: 2 }]);
	});

	it("does not publish successful references from a retired content source", async () => {
		let resolve: (value: unknown) => void = () => {
			throw new Error("Lookup not started.");
		};
		const invoke = vi.fn(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const source = new SpellReferences({ invoke });
		const pending = source.load([1]);
		await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
		source.dispose();
		resolve([{ kind: "missing", id: 1 }]);
		expect(await pending).toEqual([
			{ kind: "failed", id: 1, detail: expect.stringContaining("retired") },
		]);
		await expect(source.load([1])).rejects.toThrow("disposed");
	});
});
