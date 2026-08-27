import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
	decodeClientLifecycle,
	decodeClientLocalPlayerEstablished,
} from "./client-host-contract";

describe("client host wire contract", () => {
	it("decodes Rust-shaped lifecycle and local-player identity independently", () => {
		const payload = encode({
			kind: "event",
			event: {
				event: "client-lifecycle-changed",
				payload: { kind: "in-world" },
			},
		});
		const frame = decode(payload);
		if (
			typeof frame !== "object" ||
			frame === null ||
			!("event" in frame) ||
			typeof frame.event !== "object" ||
			frame.event === null ||
			!("payload" in frame.event)
		) {
			throw new Error("encoded lifecycle frame did not decode as an event");
		}

		expect(decodeClientLifecycle(frame.event.payload)).toEqual({
			kind: "in-world",
		});
		expect(
			decodeClientLocalPlayerEstablished({ playerGuid: 0x5000_0008 }),
		).toEqual({ playerGuid: 0x5000_0008 });
	});
});
