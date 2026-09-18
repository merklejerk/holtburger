import { describe, expect, it } from "vitest";
import {
	clientCharacterProfileKey,
	clientServerScope,
} from "./client-profile-key";

describe("client profile keys", () => {
	it("normalizes DNS casing and brackets IPv6", () => {
		expect(clientServerScope({ host: " Example.COM ", port: 9000 })).toBe(
			"example.com:9000",
		);
		expect(clientServerScope({ host: "[2001:DB8::1]", port: 9000 })).toBe(
			"[2001:db8::1]:9000",
		);
	});

	it("combines shard scope with a fixed-width character GUID", () => {
		expect(
			clientCharacterProfileKey({ host: "example.com", port: 9000 }, 0x5001),
		).toBe("example.com:9000/0x00005001");
	});

	it("rejects invalid identities", () => {
		expect(() => clientServerScope({ host: " ", port: 9000 })).toThrow();
		expect(() =>
			clientCharacterProfileKey({ host: "example.com", port: 9000 }, -1),
		).toThrow();
	});
});
