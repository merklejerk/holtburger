import { describe, expect, it, vi } from "vitest";
import { ClientChatComposer } from "./client-chat-composer.svelte";
import {
	CHAT_CHANNEL_DESTINATIONS,
	resolveChatCompose,
	selectedChatRecipient,
	type ChatComposeContext,
} from "./client-chat-compose";
import {
	clientChatDestinationSchema,
	clientChatRequestSchema,
} from "./client-host-contract";
import { entityFacts } from "./client-entity-mirror.test-support";

const professor = {
	kind: "npc",
	guid: 0x80000001,
	name: "Professor of War Magic",
} as const;
const player = { kind: "player", name: "Some Player" } as const;
const context: ChatComposeContext = {
	emotes: null,
	destination: { kind: "channel", channel: "fellowship" },
	reply: player,
	retell: professor,
	selection: { kind: "target", target: professor },
};

describe("chat composition", () => {
	it("shares one complete destination catalog with picker and command aliases", () => {
		expect(
			CHAT_CHANNEL_DESTINATIONS.map((entry) => entry.channel).sort(),
		).toEqual([...clientChatDestinationSchema.options].sort());
		for (const definition of CHAT_CHANNEL_DESTINATIONS) {
			for (const alias of definition.aliases) {
				for (const prefix of ["/", "@"]) {
					const result = resolveChatCompose(`${prefix}${alias} hello`, context);
					expect(result).toMatchObject({
						kind: "send",
						request: {
							kind: "channel",
							channel: definition.channel,
							message: "hello",
						},
					});
					if (result.kind === "send")
						expect(
							clientChatRequestSchema.safeParse(result.request).success,
						).toBe(true);
				}
			}
		}
	});

	it.each(["/t", "/tell", "@tell"])(
		"resolves %s with a multiword name and the first comma, independently of NPC selection",
		(command) => {
			expect(
				resolveChatCompose(`${command} Some Player , hello, again`, context),
			).toMatchObject({
				kind: "send",
				label: "Tell → Some Player",
				buttonLabel: "Some Player",
				buttonIcon: "tell",
				request: { kind: "tell", target: player, message: "hello, again" },
			});
			expect(
				resolveChatCompose(`${command} ${professor.name}, level 1`, context),
			).toMatchObject({
				kind: "send",
				request: { target: { kind: "player", name: professor.name } },
			});
		},
	);

	it.each(["/ts", "/tellselected"])(
		"resolves %s for either target kind without changing the persistent destination",
		(command) => {
			for (const target of [professor, player]) {
				expect(
					resolveChatCompose(`${command} level 1`, {
						...context,
						selection: { kind: "target", target },
					}),
				).toMatchObject({
					kind: "send",
					request: { kind: "tell", target, message: "level 1" },
					buttonLabel: target.name,
					buttonIcon: "tell",
				});
			}
			expect(context.destination).toEqual({
				kind: "channel",
				channel: "fellowship",
			});
		},
	);

	it.each(["/r", "/reply", "/rt", "/retell"])(
		"keeps %s independent of picker and selection",
		(command) => {
			const reply = command === "/r" || command === "/reply";
			expect(resolveChatCompose(`${command} hello`, context)).toMatchObject({
				kind: "send",
				request: { target: reply ? player : professor },
			});
			expect(
				resolveChatCompose(`${command} hello`, {
					...context,
					reply: null,
					retell: null,
				}),
			).toMatchObject({ kind: "error", label: reply ? "Reply" : "Retell" });
		},
	);

	it("uses the picker for plain text while explicit commands override it", () => {
		expect(resolveChatCompose("  hello  ", context)).toMatchObject({
			kind: "send",
			request: { kind: "channel", channel: "fellowship", message: "hello" },
		});
		expect(resolveChatCompose("/rt hello", context)).toMatchObject({
			kind: "send",
			request: { target: professor },
		});
	});

	it("keeps app/server dispatch separate from speech and exact chat command tokens", () => {
		for (const command of [
			"/help",
			"/corpse",
			"/allegiance hometown",
			"@servercommand args",
			"/unknown",
			"/tellmore hi",
			"/",
		]) {
			expect(resolveChatCompose(command, context)).toEqual({
				kind: "app-command",
				label: "Command",
				buttonLabel: "Cmd",
				buttonIcon: "speech",
			});
		}
		expect(
			resolveChatCompose("/allegiance broadcast notice", context),
		).toMatchObject({
			kind: "send",
			request: { channel: "allegiance-broadcast", message: "notice" },
		});
		expect(resolveChatCompose("/say /literal", context)).toMatchObject({
			kind: "send",
			request: { kind: "speech", message: "/literal" },
		});
		expect(resolveChatCompose("/emote waves", context)).toMatchObject({
			kind: "send",
			request: { kind: "emote", message: "waves" },
		});
	});

	it("rejects each incomplete command without inventing a destination", () => {
		for (const command of [
			"/tell",
			"/t no comma",
			"/t , body",
			"/t Player,",
			"/ts",
			"/r",
			"/rt",
			"/emote",
			"/f",
			"/allegiance broadcast",
		]) {
			expect(resolveChatCompose(command, context).kind, command).toBe("error");
		}
		const errors = (["none", "pending", "ineligible"] as const).map((kind) =>
			resolveChatCompose("/ts hello", {
				...context,
				selection: { kind },
			}),
		);
		expect(
			new Set(
				errors.map((result) =>
					result.kind === "error" ? result.message : "unexpected",
				),
			).size,
		).toBe(errors.length);
	});

	it("uses world creature admission and player classification for selection", () => {
		expect(selectedChatRecipient(null, undefined)).toEqual({ kind: "none" });
		expect(selectedChatRecipient(1, undefined)).toEqual({ kind: "pending" });
		const item = entityFacts(professor.guid);
		expect(selectedChatRecipient(professor.guid, item)).toEqual({
			kind: "ineligible",
		});
		if (item.description.kind !== "known")
			throw new Error("Selection fixture requires a known description.");
		const npc = {
			...item,
			targeting: "creature" as const,
			description: {
				...item.description,
				mapCategory: "npc" as const,
				name: professor.name,
			},
		};
		expect(selectedChatRecipient(professor.guid, npc)).toEqual({
			kind: "target",
			target: professor,
		});
		const otherPlayer = {
			...npc,
			guid: 0x50000001,
			description: {
				...npc.description,
				mapCategory: "player" as const,
				name: player.name,
			},
		};
		expect(selectedChatRecipient(otherPlayer.guid, otherPlayer)).toEqual({
			kind: "target",
			target: player,
		});
	});
});

describe("character-session chat convenience state", () => {
	it("tracks addressable incoming tellers before display filtering and leaves retell independent", async () => {
		const composer = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		for (const target of [player, professor]) {
			composer.accept({
				kind: "tell",
				category: "tell",
				target,
				sender: target.name,
				speakerKind: target.kind === "npc" ? "non-player" : "player",
				message: "hello",
			});
			expect(composer.reply).toEqual(target);
		}
		composer.accept({
			kind: "tell",
			category: "tell",
			target: null,
			sender: "Unknown",
			speakerKind: "unknown",
			message: "unknown",
		});
		expect(composer.reply).toEqual(professor);
		await composer.sendAll(
			[{ kind: "tell", target: player, message: "hello" }],
			async () => {},
		);
		expect(composer.retell).toEqual(player);
		expect(composer.reply).toEqual(professor);
		const reject = vi.fn().mockRejectedValue(new Error("enqueue failed"));
		await expect(
			composer.sendAll(
				[{ kind: "tell", target: professor, message: "hello" }],
				reject,
			),
		).rejects.toThrow("enqueue failed");
		expect(composer.retell).toEqual(player);
	});

	it("freezes a resolved reply and discards stale completion across a character-session reset", async () => {
		const composer = new ClientChatComposer({
			recentEmotes: [],
			onRecentEmotesChange: () => {},
		});
		composer.reply = professor;
		composer.destination = { kind: "channel", channel: "fellowship" };
		const resolved = resolveChatCompose("/r level 1", {
			...context,
			reply: composer.reply,
		});
		if (resolved.kind !== "send")
			throw new Error("Reply fixture must resolve a send.");
		let release: () => void = () => {
			throw new Error("Enqueue fixture was not started.");
		};
		const pending = composer.sendAll(
			[resolved.request],
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		composer.reply = player;
		expect(resolved.request).toMatchObject({ target: professor });
		composer.reset();
		release();
		await expect(pending).rejects.toThrow(
			"Chat session changed during dispatch.",
		);
		expect(composer.reply).toBeNull();
		expect(composer.retell).toBeNull();
		expect(composer.destination).toEqual({ kind: "speech" });
	});
});
