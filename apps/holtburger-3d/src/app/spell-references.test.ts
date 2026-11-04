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

	it("coalesces failed requests and retries without discarding confirmed definitions", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce([{ kind: "missing", id: 1 }])
			.mockRejectedValueOnce(new Error("Content transport unavailable"))
			.mockResolvedValueOnce([{ kind: "missing", id: 2 }]);
		const source = new SpellReferences({ invoke });
		await source.load([1]);
		const first = source.load([2]);
		const concurrent = source.load([2]);
		const failed = [
			{ kind: "failed", id: 2, detail: "Content transport unavailable" },
		];
		expect(await first).toEqual(failed);
		expect(await concurrent).toEqual(failed);
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(await source.load([1, 2])).toEqual([
			{ kind: "missing", id: 1 },
			{ kind: "missing", id: 2 },
		]);
		expect(invoke.mock.calls[2]).toEqual([
			"load_spell_references",
			{ request: { spellIds: [2] } },
		]);
		await source.load([1, 2]);
		expect(invoke).toHaveBeenCalledTimes(3);
	});

	it("retains named definitions even when their artwork is unavailable", async () => {
		const reference = {
			kind: "known",
			id: 6115,
			name: "Incantation of Summoning Mastery Other",
			details: {
				castingRoute: "selected-target",
				classification: {
					beneficial: true,
					level: 8,
					recipient: "creature",
					fellowship: false,
					damage: null,
				},
				description: "Increases the target's Summoning skill by 45 points.",
				school: 4,
				usesProjectileHandler: false,
				baseMana: 1,
				manaPerTarget: 0,
				durationSeconds: null,
				cantripTier: null,
			},
			artwork: { kind: "failed", detail: "Artwork unavailable" },
		};
		const invoke = vi.fn().mockResolvedValue([reference]);
		const source = new SpellReferences({ invoke });
		expect(await source.load([6115])).toEqual([reference]);
		expect(await source.load([6115])).toEqual([reference]);
		expect(invoke).toHaveBeenCalledTimes(1);
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
