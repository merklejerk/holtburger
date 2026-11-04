import { describe, expect, it } from "vitest";
import { chatCompletion } from "./client-chat-completion";
import { CLIENT_COMMANDS } from "./client-command-catalog";
import { clientCommandHelp } from "./client-command-help";
import { soulEmoteFixture } from "./client-soul-emotes.test-support";

const emotes = soulEmoteFixture();

function complete(text: string, caret = text.length, local = true) {
	return chatCompletion(text, caret, local, emotes);
}

describe("chat command completion", () => {
	it.each(["/", "@"])(
		"discovers commands with %s independently of emote content",
		(prefix) => {
			const result = chatCompletion(prefix, prefix.length, false, null);
			expect(result?.choices).toHaveLength(CLIENT_COMMANDS.length);
			expect(
				result?.choices.every((choice) =>
					choice.replacement.startsWith(prefix),
				),
			).toBe(true);
		},
	);

	it("groups aliases by command and preserves the typed prefix", () => {
		const result = complete("  @TE");
		expect(result?.choices.map((choice) => choice.replacement)).toEqual([
			"@tell ",
			"@tellselected ",
		]);
		expect(result).toMatchObject({ start: 2, end: 5 });
		expect(complete("/ls")?.choices).toEqual([
			expect.objectContaining({
				label: "/lifestone · /ls",
				replacement: "/ls ",
			}),
		]);
	});

	it("offers fixed command paths before an argument body exists", () => {
		expect(
			complete("/hou")?.choices.map((choice) => choice.replacement),
		).toEqual(["/house mansion_recall ", "/house recall "]);
	});

	it("replaces a command token while preserving the existing message body", () => {
		const draft = "/te Alice, hi";
		const result = complete(draft, 3);
		const choice = result?.choices.find(
			(choice) => choice.id === "command:tell",
		);
		expect(result).toMatchObject({ start: 0, end: 4 });
		expect(choice?.replacement).toBe("/tell ");
		if (result === null || choice === undefined)
			throw new Error("Tell completion missing");
		expect(
			draft.slice(0, result.start) +
				choice.replacement +
				draft.slice(result.end),
		).toBe("/tell Alice, hi");
	});

	it.each(["/tell Bob, hi", "/help co", "/house re", "/unknown", "Hello /te"])(
		"leaves argument text and ordinary speech alone: %s",
		(draft) => {
			expect(complete(draft)).toBeNull();
		},
	);

	it("uses unique executable names for completion and targeted help", () => {
		const names = CLIENT_COMMANDS.flatMap((command) => command.invocations);
		expect(new Set(names).size).toBe(names.length);
		for (const command of CLIENT_COMMANDS) {
			for (const name of command.invocations) {
				expect(clientCommandHelp(name)).toEqual(
					clientCommandHelp(command.invocations[0]),
				);
			}
		}
	});
});

describe("chat soul-emote completion", () => {
	it("matches aliases case-insensitively with one choice per pose", () => {
		expect(emotes.resolve("HI")?.id).toBe("wave");
		expect(complete("*H")?.choices).toEqual([
			expect.objectContaining({
				id: "emote:wave",
				replacement: "*hello*",
				detail: "You wave.",
			}),
		]);
		expect(complete("*")?.choices).toHaveLength(emotes.references.length);
	});

	it("replaces the active span while keeping surrounding speech", () => {
		const draft = "Hello *wav* friend";
		const result = complete(draft, draft.indexOf("* friend"));
		expect(result).toMatchObject({ start: 6, end: 11 });
		expect(result?.choices[0].replacement).toBe("*wave*");
	});

	it("accepts multiword aliases and explicit local speech", () => {
		expect(complete("*warm h")?.choices[0].replacement).toBe("*warm hands*");
		expect(
			complete("/say Hello *wa", undefined, false)?.choices.map(
				(choice) => choice.replacement,
			),
		).toContain("*wave*");
		expect(complete("*wav", undefined, false)?.choices[0].replacement).toBe(
			"*wave*",
		);
	});

	it.each(["/tell Bob, *wa", "/emote *wa", "Hi *wa", "*wave*", "plain text"])(
		"respects message routing and completed spans: %s",
		(draft) => {
			expect(complete(draft, undefined, false)).toBeNull();
		},
	);
});
