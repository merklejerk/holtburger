import { describe, expect, it } from "vitest";
import {
	compactInputHint,
	formatInputBinding,
	formatInputBindings,
	formatInputPill,
	inputDisplayPlatform,
	modifierName,
} from "./input-presentation";

describe("input presentation", () => {
	it("uses OS names without changing modifier identities", () => {
		const chord = { code: "Digit1", ctrl: true, shift: true, meta: true };
		expect(formatInputBinding(chord, "mac")).toBe(
			"Control + Shift + Command + 1",
		);
		expect(compactInputHint([chord], "mac")).toBe("⌃⇧⌘1");
		expect(formatInputBinding(chord, "windows")).toBe(
			"Ctrl + Shift + Windows + 1",
		);
		expect(compactInputHint([chord], "windows")).toBe("CSW1");
		expect(formatInputBinding(chord, "linux")).toBe("Ctrl + Shift + Super + 1");
		expect(formatInputBinding(chord, "unknown")).toBe(
			"Ctrl + Shift + Meta + 1",
		);
		expect(modifierName("alt", "mac")).toBe("Option");
		expect(formatInputPill({ code: "Digit1", meta: true }, "mac")).toBe("⌘1");
		expect(formatInputPill({ code: "Digit1", ctrl: true }, "windows")).toBe(
			"Ctrl+1",
		);
	});

	it("shows the first hint and all readable alternatives", () => {
		const bindings = [
			{ code: "Digit1", shift: true },
			{ key: "PageDown", alt: true },
		];
		expect(compactInputHint(bindings, "windows")).toBe("S1");
		expect(formatInputBindings(bindings, "mac")).toBe(
			"Shift + 1 / Option + Page Down",
		);
		expect(compactInputHint([], "mac")).toBeNull();
		expect(formatInputBindings([], "mac")).toBe("Unbound");
	});

	it("keeps modifier-only keys, arrows, and numpad addresses distinct", () => {
		expect(formatInputBinding({ key: "Meta", meta: true }, "mac")).toBe(
			"Command",
		);
		expect(compactInputHint([{ key: "Shift", shift: true }], "mac")).toBe("⇧");
		expect(compactInputHint([{ key: "ArrowLeft" }], "linux")).toBe("←");
		expect(compactInputHint([{ code: "Numpad1" }], "linux")).toBe("N1");
		expect(formatInputBinding({ code: "Numpad1" }, "linux")).toBe("Numpad 1");
	});

	it("resolves a display platform from the browser user agent", () => {
		expect(
			inputDisplayPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)"),
		).toBe("mac");
		expect(inputDisplayPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe(
			"windows",
		);
		expect(inputDisplayPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(
			"linux",
		);
		expect(inputDisplayPlatform("test host")).toBe("unknown");
	});
});
