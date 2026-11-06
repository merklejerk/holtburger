import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_BUILD_LABEL } from "../app/app-build";
import { runClientCopyEntityCommand } from "./client-copy-entity-command";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientChatMessage } from "./client-host-contract";
import type { ClientSelectedEntity } from "./client-selected-entity";
import { targetingEntity } from "./client-targeting.test-support";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const guid = 0x80000001;

describe("copy entity command", () => {
	it.each(["/copyent", " @COPYENT "])(
		"copies the selected projection and build metadata for %s",
		async (command) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
			const writeText = vi
				.fn<(text: string) => Promise<void>>()
				.mockResolvedValue();
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			const append = vi.fn();
			const facts = entityFacts(guid);
			if (facts.description.kind !== "known")
				throw new Error("Known fixture required.");
			const selected: ClientSelectedEntity = {
				guid,
				facts: { ...facts, description: { ...facts.description, wcid: 42 } },
				presentation: targetingEntity(guid, 1),
			};
			expect(
				await runClientCopyEntityCommand(command, () => selected, append),
			).toBe(true);
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
				build: APP_BUILD_LABEL,
				capturedAt: "2026-11-06T12:00:00.000Z",
				guidHex: "0x80000001",
				wcidHex: "0x0000002a",
				...selected,
			});
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: "Entity 0x80000001 report copied to clipboard.",
			});
		},
	);

	it.each([
		entityFacts(guid, {
			location: { kind: "contained", parentGuid: 1, slot: { kind: "pending" } },
		}),
		null,
	])(
		"preserves unavailable scene data and facts for an inventory or pending selection",
		async (facts) => {
			const writeText = vi
				.fn<(text: string) => Promise<void>>()
				.mockResolvedValue();
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			await runClientCopyEntityCommand(
				"/copyent",
				() => ({ guid, facts, presentation: null }),
				vi.fn(),
			);
			expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
				guid,
				facts,
				presentation: null,
				wcidHex: null,
			});
		},
	);

	it("rejects a missing selection and arguments without touching the clipboard", async () => {
		const writeText = vi.fn();
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const append = vi.fn();
		await expect(
			runClientCopyEntityCommand("/copyent", () => null, append),
		).rejects.toThrow("Select an entity");
		await expect(
			runClientCopyEntityCommand("@copyent extra", () => null, append),
		).rejects.toThrow("Usage: /copyent");
		expect(writeText).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it("retains the captured report when clipboard access rejects after selection changes", async () => {
		let selected: ClientSelectedEntity | null = {
			guid,
			facts: entityFacts(guid),
			presentation: null,
		};
		vi.stubGlobal("navigator", {
			clipboard: {
				writeText: async () => {
					selected = null;
					throw new Error("Permission denied");
				},
			},
		});
		const append = vi.fn<(message: ClientChatMessage) => void>();
		await expect(
			runClientCopyEntityCommand("/copyent", () => selected, append),
		).rejects.toThrow(
			"Entity report printed in chat, but clipboard copy failed: Permission denied",
		);
		expect(append).toHaveBeenCalledTimes(1);
		const notice = append.mock.calls[0][0];
		if (notice.kind !== "system") throw new Error("Expected a local report.");
		expect(JSON.parse(notice.message)).toMatchObject({
			guid,
			facts: entityFacts(guid),
		});
	});

	it.each(["hello", "/copyentity", "@copyentextra"])(
		"leaves %s to normal routing",
		async (message) => {
			const read = vi.fn();
			const append = vi.fn();
			expect(await runClientCopyEntityCommand(message, read, append)).toBe(
				false,
			);
			expect(read).not.toHaveBeenCalled();
			expect(append).not.toHaveBeenCalled();
		},
	);
});
