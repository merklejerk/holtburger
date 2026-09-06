import { afterEach, expect, it, vi } from "vitest";
import { createCdpClient } from "./cdp-client.mjs";

/** Test-owned socket exercises transport lifecycle without a browser or network listener. */
class Socket extends EventTarget {
	static readonly OPEN = 1;
	readyState = 0;
	send = vi.fn();
	close() {
		this.readyState = 3;
		this.dispatchEvent(new Event("close"));
	}
	open() {
		this.readyState = Socket.OPEN;
		this.dispatchEvent(new Event("open"));
	}
}

function connect() {
	const socket = new Socket();
	vi.stubGlobal(
		"WebSocket",
		Object.assign(
			function () {
				return socket;
			},
			{ OPEN: Socket.OPEN },
		),
	);
	return { socket, connected: createCdpClient("ws://fixture") };
}

afterEach(() => vi.unstubAllGlobals());

it("rejects closure before opening", async () => {
	const { socket, connected } = connect();
	const rejected = expect(connected).rejects.toThrow("CDP connection closed");
	socket.close();
	await rejected;
});

it("rejects every pending request and subsequent sends on closure", async () => {
	const { socket, connected } = connect();
	socket.open();
	const client = await connected;
	const pending = [client.send("Page.enable"), client.send("Runtime.enable")];
	const rejected = pending.map((request) =>
		expect(request).rejects.toThrow("CDP connection closed"),
	);
	client.close();
	await Promise.all(rejected);
	await expect(client.send("Page.enable")).rejects.toThrow(
		"CDP connection is not open",
	);
});

it("settles replies and removes event subscriptions", async () => {
	const { socket, connected } = connect();
	socket.open();
	const client = await connected;
	const listener = vi.fn();
	const unsubscribe = client.on("Page.loadEventFired", listener);
	const emit = (message: unknown) =>
		socket.dispatchEvent(
			new MessageEvent("message", { data: JSON.stringify(message) }),
		);
	emit({ method: "Page.loadEventFired", params: { timestamp: 1 } });
	unsubscribe();
	emit({ method: "Page.loadEventFired", params: { timestamp: 2 } });
	expect(listener).toHaveBeenCalledExactlyOnceWith({ timestamp: 1 });
	const request = client.send("Page.enable");
	const { id } = JSON.parse(socket.send.mock.calls[0][0]);
	emit({ id, result: { enabled: true } });
	await expect(request).resolves.toEqual({ enabled: true });
	client.close();
});
