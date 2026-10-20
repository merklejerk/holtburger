import { describe, expect, it, vi } from "vitest";
import {
	resolveChatCompose,
	type ChatComposeContext,
} from "./client-chat-compose";
import {
	ChatSubmissionError,
	ClientChatComposer,
} from "./client-chat-composer.svelte";
import { ClientSoulEmotes } from "./client-soul-emotes";
import {
	emoteWheelEntries,
	nextEmoteEntry,
	presentSoulEmote,
} from "./client-emote-wheel";
import { soulEmoteFixture } from "./client-soul-emotes.test-support";
import { CLIENT_TUNING } from "./client-tuning";
import { CLIENT_KEYBOARD_DEFAULTS } from "./client-input-settings";
import {
	CLIENT_BINDING_ROWS,
	conflictingClientBindings,
} from "./client-binding-catalog";
import { readClientBinding } from "../lib/input/client-keyboard-bindings";

const catalog = soulEmoteFixture();
const context: ChatComposeContext = {
	destination: { kind: "speech" },
	reply: null,
	retell: null,
	selection: { kind: "none" },
	emotes: catalog,
};
function requests(text: string, ctx: ChatComposeContext) {
	const result = resolveChatCompose(text, ctx);
	if (result.kind === "sequence") return result.requests;
	if (result.kind === "send") return [result.request];
	throw new Error(`Unexpected resolution: ${result.kind}`);
}

describe("soul-emote composition", () => {
	it("overrides a picker destination only for a standalone recognized gesture", () => {
		const privateContext: ChatComposeContext = {
			...context,
			destination: { kind: "tell", target: { kind: "player", name: "Bob" } },
		};
		expect(requests("*WAVE*", privateContext)).toEqual([
			{ kind: "soul-emote", token: "WAVE" },
		]);
		expect(requests("hello *wave*", privateContext)).toEqual([
			{
				kind: "tell",
				target: { kind: "player", name: "Bob" },
				message: "hello *wave*",
			},
		]);
		expect(privateContext.destination.kind).toBe("tell");
	});
	it("executes paired local gestures left to right without an empty speech send", () => {
		expect(requests("/say Hello *wave* and *bow deep*", context)).toEqual([
			{ kind: "soul-emote", token: "wave" },
			{ kind: "soul-emote", token: "bow deep" },
			{ kind: "speech", message: "Hello  and" },
		]);
		expect(requests("*wave* *bow*", context)).toHaveLength(2);
	});
	it.each(["*unknown*", "*wave", "ordinary *emphasis*", "**"])(
		"preserves literal %s",
		(text) => {
			expect(requests(text, context)).toEqual([
				{ kind: "speech", message: text },
			]);
		},
	);
	it.each(["/tell Bob, *wave*", "/general *wave*", "/emote *wave*"])(
		"keeps explicit route literal: %s",
		(text) => {
			expect(requests(text, context)[0]).toMatchObject({ message: "*wave*" });
		},
	);
});

describe("soul-emote catalog", () => {
	it("rejects malformed or ambiguous catalog projections", () => {
		expect(() => new ClientSoulEmotes([])).toThrow();
		expect(
			() =>
				new ClientSoulEmotes([...catalog.references, catalog.references[0]]),
		).toThrow("Duplicate soul-emote pose");
		expect(
			() =>
				new ClientSoulEmotes([
					{ ...catalog.references[0], aliases: ["hi", "HI"] },
				]),
		).toThrow("Duplicate soul-emote alias");
	});
});

describe("queued usage history", () => {
	it("restores user history and persists catalog cleanup without changing valid order", async () => {
		let saved: readonly string[] = ["missing", "wave", "wave", "bowdeepstate"];
		const changed = vi.fn((ids: readonly string[]) => {
			saved = ids;
		});
		const owner = new ClientChatComposer({
			recentEmotes: saved,
			onRecentEmotesChange: changed,
		});
		owner.setEmotes(catalog);
		expect(saved).toEqual(
			["wave", "bowdeepstate"].slice(0, CLIENT_TUNING.emotes.recentLimit),
		);
		expect(changed).toHaveBeenCalledTimes(1);
		owner.setEmotes(catalog);
		expect(changed).toHaveBeenCalledTimes(1);
		await owner.sendAll([{ kind: "soul-emote", token: "bow" }], async () => {});
		const restarted = new ClientChatComposer({
			recentEmotes: saved,
			onRecentEmotesChange: changed,
		});
		restarted.setEmotes(catalog);
		expect(restarted.recentEmotes).toEqual(
			["bowdeepstate", "wave"].slice(0, CLIENT_TUNING.emotes.recentLimit),
		);
		expect(changed).toHaveBeenCalledTimes(2);
		restarted.reset();
		expect(restarted.recentEmotes).toEqual(saved);
	});

	it("trims loaded history to the configured limit after filtering missing identities", () => {
		const references = Array.from(
			{ length: CLIENT_TUNING.emotes.recentLimit + 2 },
			(_, index) => ({
				id: `pose${index}`,
				pose: `Pose${index}`,
				aliases: [`alias${index}`],
				myEmote: null,
				otherEmote: null,
			}),
		);
		const changed = vi.fn();
		const owner = new ClientChatComposer({
			recentEmotes: ["missing", ...references.map((reference) => reference.id)],
			onRecentEmotesChange: changed,
		});
		owner.setEmotes(new ClientSoulEmotes(references));
		const expected = references
			.slice(0, CLIENT_TUNING.emotes.recentLimit)
			.map((reference) => reference.id);
		expect(owner.recentEmotes).toEqual(expected);
		expect(changed).toHaveBeenCalledExactlyOnceWith(expected);
	});

	it("does not persist failed or stale queue attempts over saved user history", async () => {
		const changed = vi.fn();
		const saved = ["bowdeepstate"].slice(0, CLIENT_TUNING.emotes.recentLimit);
		const owner = new ClientChatComposer({
			recentEmotes: saved,
			onRecentEmotesChange: changed,
		});
		owner.setEmotes(catalog);
		await expect(
			owner.sendAll([{ kind: "soul-emote", token: "wave" }], async () => {
				throw new Error("Disconnected");
			}),
		).rejects.toThrow("Disconnected");
		await expect(
			owner.sendAll([{ kind: "soul-emote", token: "wave" }], async () => {
				owner.reset();
			}),
		).rejects.toThrow("Chat session changed");
		expect(owner.recentEmotes).toEqual(saved);
		expect(changed).not.toHaveBeenCalled();
	});

	it("updates after queue acknowledgment, deduplicates aliases, and survives session resets", async () => {
		const owner = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		owner.setEmotes(catalog);
		let finish: () => void = () => {
			throw new Error("Queue not started");
		};
		const sending = owner.sendAll(
			[{ kind: "soul-emote", token: "HI" }],
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		expect(owner.recentEmotes).toEqual([]);
		finish();
		await sending;
		await owner.sendAll([{ kind: "soul-emote", token: "bow" }], async () => {});
		await owner.sendAll(
			[{ kind: "soul-emote", token: "wave" }],
			async () => {},
		);
		expect(owner.recentEmotes).toEqual(
			["wave", "bowdeepstate"].slice(0, CLIENT_TUNING.emotes.recentLimit),
		);
		const recent = [...owner.recentEmotes];
		owner.reset();
		expect(owner.recentEmotes).toEqual(recent);
	});
	it("bounds Recent using the configured limit", async () => {
		const owner = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		const references = Array.from(
			{ length: CLIENT_TUNING.emotes.recentLimit + 2 },
			(_, index) => ({
				id: `pose${index}`,
				pose: `Pose${index}`,
				aliases: [`alias${index}`],
				myEmote: null,
				otherEmote: null,
			}),
		);
		owner.setEmotes(new ClientSoulEmotes(references));
		for (const reference of references) {
			await owner.sendAll(
				[{ kind: "soul-emote", token: reference.aliases[0] }],
				async () => {},
			);
		}
		expect(owner.recentEmotes).toEqual(
			references
				.map((entry) => entry.id)
				.reverse()
				.slice(0, CLIENT_TUNING.emotes.recentLimit),
		);
	});
	it("validates all actions before side effects and reports partial queueing without retries", async () => {
		const owner = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		owner.setEmotes(catalog);
		const enqueue = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("Disconnected"));
		await expect(
			owner.sendAll(
				[
					{ kind: "soul-emote", token: "wave" },
					{ kind: "soul-emote", token: "missing" },
				],
				enqueue,
			),
		).rejects.toThrow("Unknown soul emote");
		expect(enqueue).not.toHaveBeenCalled();
		await expect(
			owner.sendAll(
				[
					{ kind: "soul-emote", token: "wave" },
					{ kind: "speech", message: "Hello" },
				],
				enqueue,
			),
		).rejects.toMatchObject({ queued: 1 });
		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(owner.recentEmotes).toEqual(
			["wave"].slice(0, CLIENT_TUNING.emotes.recentLimit),
		);
	});
	it("retires stale completions and stops the remaining sequence", async () => {
		const owner = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		owner.setEmotes(catalog);
		const enqueue = vi.fn(async () => {
			owner.reset();
		});
		await expect(
			owner.sendAll(
				[
					{ kind: "soul-emote", token: "wave" },
					{ kind: "speech", message: "Hi" },
				],
				enqueue,
			),
		).rejects.toBeInstanceOf(ChatSubmissionError);
		expect(enqueue).toHaveBeenCalledTimes(1);
		expect(owner.recentEmotes).toEqual([]);
	});
});

describe("curated wheel", () => {
	it("has stable categories, missing diagnostics, and full-catalog recent leaves", () => {
		const root = emoteWheelEntries(catalog, [], null);
		expect(root.map((entry) => entry.label)).toEqual([
			"Greetings",
			"Reactions",
			"Signals",
			"Attitude",
			"Relax & play",
			"Recent",
		]);
		expect(root[5]).toMatchObject({ disabled: true });
		const greeting = emoteWheelEntries(catalog, [], 0);
		expect(greeting.map((entry) => entry.label)).toEqual([
			"Wave",
			"Bow",
			"curtsey",
			"salute",
			"blow kiss",
			"be seeing you",
		]);
		expect(greeting[2]).toMatchObject({
			kind: "missing",
			detail: expect.stringContaining("curtsey"),
		});
		expect(nextEmoteEntry(greeting, 1, 1)).toBe(0);
		expect(emoteWheelEntries(catalog, ["shiver"], 5)).toMatchObject([
			{ kind: "emote", alias: "brrr", reference: { id: "shiver" } },
		]);
		expect(presentSoulEmote(catalog.references[0])).toEqual({
			alias: "wave",
			label: "Wave",
		});
	});
	it("has no overlap for the default configured activation chord", () => {
		const row = CLIENT_BINDING_ROWS.find(
			(row) => row.id === "client.openEmotes",
		);
		if (row === undefined) throw new Error("Missing emote binding");
		for (const binding of readClientBinding(
			CLIENT_KEYBOARD_DEFAULTS,
			row.reference,
		))
			expect(
				conflictingClientBindings(CLIENT_KEYBOARD_DEFAULTS, row, binding, null),
			).toEqual([]);
	});
});
