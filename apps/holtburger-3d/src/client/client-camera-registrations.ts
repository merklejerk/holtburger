import type {
	ClientCameraIdentity,
	ClientCameraStartRequest,
	ClientCameraStartReceipt,
} from "./client-host-contract";
import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../lib/async-lifetime";

/** One native registration retains its receipt independently of the cancelled local waiter. */
interface Registration {
	/** Exact request whose ordered native receipt is being observed. */
	readonly request: ClientCameraStartRequest;
	/** Owned receipt resolver; another registration cannot overwrite it. */
	readonly receive: (identity: ClientCameraIdentity) => void;
	/** Receipt rejection is observed together with the command acknowledgement. */
	readonly reject: (error: unknown) => void;
}

/** Session-owned camera requests survive driver retirement but never authority retirement. */
export class ClientCameraRegistrations {
	readonly #start: (request: ClientCameraStartRequest) => Promise<void>;
	readonly #stop: (identity: ClientCameraIdentity) => Promise<void>;
	readonly #report: (error: unknown) => void;
	#pending: Registration | null = null;
	#tail: Promise<void> = Promise.resolve();
	#epoch = new AbortController();
	#open = true;

	constructor(dependencies: {
		readonly start: (request: ClientCameraStartRequest) => Promise<void>;
		readonly stop: (identity: ClientCameraIdentity) => Promise<void>;
		readonly report: (error: unknown) => void;
	}) {
		this.#start = dependencies.start;
		this.#stop = dependencies.stop;
		this.#report = dependencies.report;
	}

	/** All registrations are serialized: the wire receipt carries no caller request ID. */
	register(
		request: ClientCameraStartRequest,
		signal: AbortSignal,
	): Promise<ClientCameraIdentity> {
		const epoch = this.#epoch.signal;
		const native = this.#tail.then(async () => {
			signal.throwIfAborted();
			epoch.throwIfAborted();
			if (!this.#open) throw abortError("Camera authority is closing.");
			let receive: Registration["receive"] = () => {
				throw new Error("Camera receipt not initialized.");
			};
			let reject: Registration["reject"] = () => {
				throw new Error("Camera receipt not initialized.");
			};
			const receipt = new Promise<ClientCameraIdentity>((resolve, fail) => {
				receive = resolve;
				reject = fail;
			});
			const registration: Registration = { request, receive, reject };
			this.#pending = registration;
			try {
				// Observe both promises immediately: a receipt can fail while command IPC is still pending.
				const acknowledged = Promise.all([this.#start(request), receipt]).then(
					([, identity]) => identity,
				);
				const identity = await awaitWithAbort(acknowledged, epoch);
				if (signal.aborted) await this.stop(identity);
				return identity;
			} finally {
				if (this.#pending === registration) this.#pending = null;
			}
		});
		this.#tail = native.then(
			() => {},
			(error) => {
				// The local caller observes live failures. A withdrawn caller still has a session-owned reporter.
				if (signal.aborted && !isAbortError(error)) this.#report(error);
			},
		);
		return awaitWithAbort(native, signal);
	}

	/** Only the pending native attempt may claim the next ordered receipt. */
	receive(identity: ClientCameraStartReceipt): void {
		const pending = this.#pending;
		if (pending === null) return;
		if (
			identity.playerGuid !== pending.request.playerGuid ||
			identity.entityGeneration !== pending.request.entityGeneration
		) {
			pending.reject(
				new Error("Client camera registration receipt changed its target."),
			);
			return;
		}
		pending.receive(identity);
	}

	/** A reset proves old camera generations cannot remain active, without closing the connection. */
	reset(): void {
		this.#epoch.abort(abortError("Camera generation retired by authority."));
		this.#epoch = new AbortController();
		this.#pending = null;
	}

	/** Stop issuing camera commands before native Disconnect/shutdown starts. */
	close(): void {
		this.#open = false;
		this.reset();
	}

	/** New session attachment owns a new camera command lifetime. */
	open(): void {
		this.reset();
		this.#open = true;
	}

	/** Existing commands may settle after withdrawal; their results cannot revive the caller. */
	command(operation: () => Promise<void>): Promise<void> {
		if (!this.#open)
			return Promise.reject(abortError("Camera authority is closing."));
		return awaitWithAbort(operation(), this.#epoch.signal);
	}

	/** Closed authority already owns release of its generations; local stop then needs no IPC. */
	async stop(identity: ClientCameraIdentity): Promise<void> {
		if (!this.#open) return;
		try {
			await this.command(() => this.#stop(identity));
		} catch (error) {
			if (!isAbortError(error)) throw error;
		}
	}
}
