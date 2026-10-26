import { expect, it, vi } from "vitest";
import { withBundledUiThemes } from "./ui-bundled-themes";
import { UiThemeSelection } from "./ui-theme-selection";
import {
	TRAVELERS_KIT_THEME_ID,
	UI_THEME_LOAD_TIMEOUT_MS,
	type UiThemeTransport,
} from "./ui-theme-contract";

// Vitest stubs CSS modules; the native probe verifies Vite's emitted asset URL.
vi.mock("./themes/travelers-kit.css?url&no-inline", () => ({
	default: "/assets/travelers-kit.css",
}));

function fixture() {
	const source: UiThemeTransport = {
		initialIds: [],
		list: vi.fn(async () => ["Night"]),
		resolve: vi.fn(async () => "holtburger-theme://local/Night/theme.css"),
		openDirectory: vi.fn(async () => {}),
	};
	const transport = withBundledUiThemes(source);
	const loader = { replace: vi.fn(async () => {}) };
	return {
		source,
		transport,
		loader,
		owner: new UiThemeSelection(transport, loader),
	};
}

it("offers bundled choices on a clean profile and delegates user themes and folder access", async () => {
	const { source, transport, loader, owner } = fixture();
	vi.mocked(source.list).mockResolvedValueOnce([]);
	expect(await owner.refresh()).toBe(true);
	expect(owner.read().catalog.ids).toEqual([TRAVELERS_KIT_THEME_ID]);
	expect(await owner.select(TRAVELERS_KIT_THEME_ID)).toBe(true);
	expect(source.resolve).not.toHaveBeenCalled();
	expect(loader.replace).toHaveBeenCalledWith(
		expect.stringContaining("travelers-kit"),
		null,
		expect.any(AbortSignal),
	);
	expect(await owner.select("Night")).toBe(true);
	expect(source.resolve).toHaveBeenCalledWith("Night");
	expect(await owner.select(null)).toBe(true);
	await transport.openDirectory();
	expect(source.openDirectory).toHaveBeenCalledOnce();
});

it("retains bundled choices on first discovery failure and previous user choices on later failure", async () => {
	const { source, owner } = fixture();
	vi.mocked(source.list).mockRejectedValueOnce(
		new Error("Unreadable themes directory"),
	);
	expect(await owner.refresh()).toBe(false);
	expect(owner.read().catalog).toMatchObject({
		kind: "failed",
		ids: [TRAVELERS_KIT_THEME_ID],
		message: expect.stringContaining("Unreadable"),
	});
	expect(await owner.select(TRAVELERS_KIT_THEME_ID)).toBe(true);
	expect(await owner.refresh()).toBe(true);
	vi.mocked(source.list).mockRejectedValueOnce(new Error("Directory removed"));
	expect(await owner.refresh()).toBe(false);
	expect(owner.read().catalog.ids).toEqual([TRAVELERS_KIT_THEME_ID, "Night"]);
});

it("reports reserved-name collisions with a rename remedy and recovers after refresh", async () => {
	const { source, owner } = fixture();
	vi.mocked(source.list).mockResolvedValueOnce([TRAVELERS_KIT_THEME_ID]);
	expect(await owner.refresh()).toBe(false);
	expect(owner.read().catalog).toMatchObject({
		kind: "failed",
		message: expect.stringContaining("Rename that folder"),
	});
	expect(await owner.select(TRAVELERS_KIT_THEME_ID)).toBe(true);
	expect(source.resolve).not.toHaveBeenCalled();
	expect(await owner.refresh()).toBe(true);
	expect(owner.read().catalog.ids).toEqual([TRAVELERS_KIT_THEME_ID, "Night"]);
});

it("keeps shipped choices usable after a stalled discovery reaches the owner's deadline", async () => {
	vi.useFakeTimers();
	try {
		const { source, owner } = fixture();
		vi.mocked(source.list).mockImplementationOnce(() => new Promise(() => {}));
		const pending = owner.refresh();
		await vi.advanceTimersByTimeAsync(UI_THEME_LOAD_TIMEOUT_MS);
		expect(await pending).toBe(false);
		expect(owner.read().catalog.ids).toEqual([TRAVELERS_KIT_THEME_ID]);
		expect(await owner.select(TRAVELERS_KIT_THEME_ID)).toBe(true);
	} finally {
		vi.useRealTimers();
	}
});
