const CDP_TIMEOUT_MS = 10_000;

/**
 * Small CDP transport shared by local Electron diagnostic probes.
 * @param {string} webSocketUrl
 * @returns {Promise<{
 *   close: () => void,
 *   on: (method: string, listener: (params: unknown) => void) => () => void,
 *   send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
 * }>}
 */
export function createCdpClient(webSocketUrl) {
	return new Promise((resolvePromise, rejectPromise) => {
		const socket = new WebSocket(webSocketUrl);
		let nextId = 1;
		/** @type {Map<string, Set<(params: unknown) => void>>} */
		const listeners = new Map();
		const pending = new Map();
		/** @param {Error} error */
		const fail = (error) => {
			clearTimeout(connectionTimeout);
			rejectPromise(error);
			for (const request of pending.values()) {
				clearTimeout(request.timer);
				request.reject(error);
			}
			pending.clear();
		};
		const connectionTimeout = setTimeout(() => {
			fail(new Error(`CDP connection timed out after ${CDP_TIMEOUT_MS} ms.`));
			socket.close();
		}, CDP_TIMEOUT_MS);
		socket.addEventListener("open", () => {
			clearTimeout(connectionTimeout);
			resolvePromise({
				close: () => socket.close(),
				on(method, listener) {
					const group = listeners.get(method) ?? new Set();
					group.add(listener);
					listeners.set(method, group);
					return () => {
						if (group.delete(listener) && group.size === 0)
							listeners.delete(method);
					};
				},
				send(method, params = {}) {
					if (socket.readyState !== WebSocket.OPEN)
						return Promise.reject(new Error("CDP connection is not open."));
					const id = nextId++;
					return new Promise((resolveRequest, rejectRequest) => {
						const timer = setTimeout(() => {
							pending.delete(id);
							rejectRequest(
								new Error(
									`CDP ${method} timed out after ${CDP_TIMEOUT_MS} ms.`,
								),
							);
						}, CDP_TIMEOUT_MS);
						pending.set(id, {
							reject: rejectRequest,
							resolve: resolveRequest,
							timer,
						});
						try {
							socket.send(JSON.stringify({ id, method, params }));
						} catch (error) {
							pending.delete(id);
							clearTimeout(timer);
							rejectRequest(error);
						}
					});
				},
			});
		});
		socket.addEventListener("error", () =>
			fail(new Error("CDP connection failed.")),
		);
		socket.addEventListener("close", () =>
			fail(new Error("CDP connection closed.")),
		);
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (!message.id) {
				for (const listener of listeners.get(message.method) ?? []) {
					listener(message.params);
				}
				return;
			}
			const request = pending.get(message.id);
			if (request === undefined) return;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
	});
}
