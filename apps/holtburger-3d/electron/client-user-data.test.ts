import { expect, it } from "vitest";
import { clientUserDataPath } from "./client-user-data";

it("isolates unpackaged and packaged Electron profiles", () => {
	expect(clientUserDataPath("/config", "holtburger-3d", true)).toBe(
		"/config/holtburger-3d",
	);
	expect(clientUserDataPath("/config", "holtburger-3d", false)).toBe(
		"/config/holtburger-3d-dev",
	);
});
