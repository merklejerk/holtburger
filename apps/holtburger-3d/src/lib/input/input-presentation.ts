import type { KeyBinding } from "./input-contract";

/** Display vocabulary only; serialized bindings retain portable modifier names. */
export type InputDisplayPlatform = "mac" | "windows" | "linux" | "unknown";
type Modifier = "ctrl" | "alt" | "shift" | "meta";
const MODIFIERS: readonly Modifier[] = ["ctrl", "alt", "shift", "meta"];

export function inputDisplayPlatform(userAgent: string): InputDisplayPlatform {
	if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
	if (/Windows/i.test(userAgent)) return "windows";
	if (/Linux/i.test(userAgent)) return "linux";
	return "unknown";
}

export function modifierName(
	modifier: Modifier,
	platform: InputDisplayPlatform,
): string {
	if (modifier === "ctrl") return platform === "mac" ? "Control" : "Ctrl";
	if (modifier === "alt") return platform === "mac" ? "Option" : "Alt";
	if (modifier === "shift") return "Shift";
	return platform === "mac"
		? "Command"
		: platform === "windows"
			? "Windows"
			: platform === "linux"
				? "Super"
				: "Meta";
}

function modifierGlyph(
	modifier: Modifier,
	platform: InputDisplayPlatform,
): string {
	if (platform === "mac")
		return { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" }[modifier];
	return {
		ctrl: "C",
		alt: "A",
		shift: "S",
		meta: platform === "windows" ? "W" : "M",
	}[modifier];
}

function selector(binding: KeyBinding, compact: boolean): string {
	const key = binding.key;
	const value = key === undefined ? binding.code : key;
	if (value === undefined) throw new Error("Input binding has no key selector");
	if (key === " ") return compact ? "Spc" : "Space";
	const names: Readonly<Record<string, readonly [string, string]>> = {
		ArrowUp: ["↑", "Arrow Up"],
		ArrowDown: ["↓", "Arrow Down"],
		ArrowLeft: ["←", "Arrow Left"],
		ArrowRight: ["→", "Arrow Right"],
		PageUp: ["PgUp", "Page Up"],
		PageDown: ["PgDn", "Page Down"],
		Backspace: ["Bksp", "Backspace"],
		Escape: ["Esc", "Escape"],
		Enter: ["Ent", "Enter"],
		Tab: ["Tab", "Tab"],
	};
	if (names[value] !== undefined) return names[value][compact ? 0 : 1];
	if (key === undefined && /^Digit[0-9]$/.test(value)) return value.slice(5);
	if (key === undefined && /^Key[A-Z]$/.test(value)) return value.slice(3);
	if (key === undefined && /^Numpad[0-9]$/.test(value))
		return compact ? `N${value.slice(6)}` : `Numpad ${value.slice(6)}`;
	return compact ? value.toUpperCase() : value;
}

function selfModifier(binding: KeyBinding): Modifier | null {
	return binding.key === "Control"
		? "ctrl"
		: binding.key === "Alt"
			? "alt"
			: binding.key === "Shift"
				? "shift"
				: binding.key === "Meta"
					? "meta"
					: null;
}

function requiredModifiers(binding: KeyBinding): readonly Modifier[] {
	const self = selfModifier(binding);
	return MODIFIERS.filter((modifier) => binding[modifier] && modifier !== self);
}

/** Full, accessible binding description; alternatives are kept in saved order. */
export function formatInputBinding(
	binding: KeyBinding,
	platform: InputDisplayPlatform,
): string {
	const base = selfModifier(binding);
	return [
		...requiredModifiers(binding).map((modifier) =>
			modifierName(modifier, platform),
		),
		base === null ? selector(binding, false) : modifierName(base, platform),
	].join(" + ");
}

/** Complete chord for a settings pill; Mac uses familiar modifier symbols. */
export function formatInputPill(
	binding: KeyBinding,
	platform: InputDisplayPlatform,
): string {
	const base = selfModifier(binding);
	if (platform !== "mac")
		return [
			...requiredModifiers(binding).map((modifier) =>
				modifierName(modifier, platform),
			),
			base === null ? selector(binding, false) : modifierName(base, platform),
		].join("+");
	return (
		requiredModifiers(binding)
			.map((modifier) => modifierGlyph(modifier, platform))
			.join("") +
		(base === null ? selector(binding, false) : modifierGlyph(base, platform))
	);
}

export function formatInputBindings(
	bindings: readonly KeyBinding[],
	platform: InputDisplayPlatform,
): string {
	return bindings.length === 0
		? "Unbound"
		: bindings
				.map((binding) => formatInputBinding(binding, platform))
				.join(" / ");
}

/** Compact first alternative for bounded HUD overlays. */
export function compactInputHint(
	bindings: readonly KeyBinding[],
	platform: InputDisplayPlatform,
): string | null {
	const binding = bindings[0];
	if (binding === undefined) return null;
	const base = selfModifier(binding);
	return (
		requiredModifiers(binding)
			.map((modifier) => modifierGlyph(modifier, platform))
			.join("") +
		(base === null ? selector(binding, true) : modifierGlyph(base, platform))
	);
}
