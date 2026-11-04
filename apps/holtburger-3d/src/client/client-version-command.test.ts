import { describe, expect, it, vi } from "vitest";
import { APP_BUILD_LABEL } from "../app/app-build";
import { resolveChatCompose } from "./client-chat-compose";
import { runClientVersionCommand } from "./client-version-command";

describe("version command", () => {
	it.each(["/version", "@version", " /VERSION "])(
		"reports frontend build identity locally for %s",
		(command) => {
			const append = vi.fn();
			expect(
				resolveChatCompose(command, {
					destination: { kind: "speech" },
					reply: null,
					retell: null,
					selection: { kind: "none" },
					emotes: null,
				}),
			).toMatchObject({ kind: "app-command" });
			expect(runClientVersionCommand(command, append)).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: `Holtburger ${APP_BUILD_LABEL}`,
			});
		},
	);
	it.each(["hello", "/versions", "/version extra"])(
		"leaves %s to normal routing",
		(command) => {
			const append = vi.fn();
			expect(runClientVersionCommand(command, append)).toBe(false);
			expect(append).not.toHaveBeenCalled();
		},
	);
});
