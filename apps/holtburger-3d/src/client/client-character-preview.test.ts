import { describe, expect, it, vi } from "vitest";
import {
	ClientCharacterPreview,
	type CharacterPreviewState,
} from "./client-character-preview";
import type { CharacterVisualRead } from "./client-visual-cache-contract";
import fixture from "./fixtures/object-preview-wire.json";
import { playerVisualCaptureSchema } from "./client-object-preview-contract";

function saved(guid: number): CharacterVisualRead {
	return {
		kind: "ready",
		capture: playerVisualCaptureSchema.parse({
			guid,
			source: fixture.equipped.outcome.source,
		}),
	};
}

function pendingRead() {
	let complete: (result: CharacterVisualRead) => void = () => {
		throw new Error("Expected pending read");
	};
	const promise = new Promise<CharacterVisualRead>((resolve) => {
		complete = resolve;
	});
	return { promise, complete };
}

describe("selected character appearance", () => {
	it("withdraws A while B loads, ignores A's stale completion, and leaves a missing B empty", async () => {
		const first = pendingRead();
		const second = pendingRead();
		const read = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const states: CharacterPreviewState[] = [];
		const owner = new ClientCharacterPreview(
			{ read, stage: vi.fn(), listenFailures: vi.fn() },
			(state) => states.push(state),
		);
		owner.select(1);
		owner.select(2);
		expect(states).toEqual([
			{ kind: "loading", guid: 1 },
			{ kind: "loading", guid: 2 },
		]);
		first.complete(saved(1));
		await Promise.resolve();
		expect(states).toHaveLength(2);
		second.complete({ kind: "missing" });
		await Promise.resolve();
		expect(states.at(-1)).toEqual({ kind: "missing", guid: 2 });
		expect(read.mock.calls).toEqual([[1], [2]]);
		owner.destroy();
	});

	it("keeps the same selected subject through roster refresh and invalidates navigation/retirement reads", async () => {
		const pending = pendingRead();
		const read = vi
			.fn()
			.mockResolvedValueOnce(saved(1))
			.mockReturnValueOnce(pending.promise);
		const publish = vi.fn();
		const owner = new ClientCharacterPreview(
			{ read, stage: vi.fn(), listenFailures: vi.fn() },
			publish,
		);
		owner.select(1);
		await Promise.resolve();
		expect(publish).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: "ready",
				guid: 1,
				source: expect.objectContaining({
					attachments: [expect.objectContaining({ placement: 1 })],
				}),
			}),
		);
		owner.select(1);
		expect(read).toHaveBeenCalledTimes(1);
		owner.select(null);
		expect(publish).toHaveBeenLastCalledWith({ kind: "none" });
		owner.select(2);
		owner.destroy();
		pending.complete(saved(2));
		await Promise.resolve();
		expect(publish).toHaveBeenLastCalledWith({ kind: "loading", guid: 2 });
	});

	it("surfaces read/identity failures locally and can select a different character afterward", async () => {
		const read = vi
			.fn()
			.mockResolvedValueOnce(saved(3))
			.mockRejectedValueOnce(new Error("unreadable file"))
			.mockResolvedValueOnce(saved(4));
		const publish = vi.fn();
		const owner = new ClientCharacterPreview(
			{ read, stage: vi.fn(), listenFailures: vi.fn() },
			publish,
		);
		owner.select(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(publish).toHaveBeenLastCalledWith({
			kind: "unavailable",
			guid: 1,
			message: "Saved appearance belongs to a different character.",
		});
		owner.select(2);
		await Promise.resolve();
		await Promise.resolve();
		expect(publish).toHaveBeenLastCalledWith({
			kind: "unavailable",
			guid: 2,
			message: "unreadable file",
		});
		owner.select(4);
		await Promise.resolve();
		expect(publish).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: "ready", guid: 4 }),
		);
		owner.destroy();
	});
});
