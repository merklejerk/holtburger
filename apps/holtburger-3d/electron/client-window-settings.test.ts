import { expect, it } from "vitest";
import { clientWindowBoundsReachable } from "./client-window-settings";

const display = { x: 0, y: 0, width: 1920, height: 1080 };

it("distinguishes reachable and removed-display window bounds", () => {
	expect(
		clientWindowBoundsReachable({ x: 100, y: 100, width: 1440, height: 900 }, [
			display,
		]),
	).toBe(true);
	expect(
		clientWindowBoundsReachable({ x: 2000, y: 100, width: 1440, height: 900 }, [
			display,
		]),
	).toBe(false);
	expect(
		clientWindowBoundsReachable({ x: 1900, y: 100, width: 1440, height: 900 }, [
			display,
		]),
	).toBe(false);
});
