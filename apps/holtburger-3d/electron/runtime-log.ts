import type {
	RuntimeLogEntry,
	RuntimeLogSnapshot,
} from "../src/app/desktop/runtime-log-contract.js";

const MAX_ENTRIES = 256;
const MAX_MESSAGE_LENGTH = 4096;
const MAX_MESSAGE_BYTES = 64 * 1024;

/** Current client document's logs. The native relay writes even while the HUD is closed. */
export class RuntimeLog {
	readonly #entries: RuntimeLogEntry[] = [];
	#revision = 0;
	#messageBytes = 0;

	record(level: RuntimeLogEntry["level"], text: string): void {
		const message =
			text.length > MAX_MESSAGE_LENGTH
				? text.slice(0, MAX_MESSAGE_LENGTH - 1) + "…"
				: text;
		const time = new Date().toISOString();
		const previous = this.#entries.at(-1);
		if (previous?.message === message && previous.level === level) {
			this.#entries[this.#entries.length - 1] = {
				time,
				level,
				message,
				count: previous.count + 1,
			};
		} else {
			this.#entries.push({ time, level, message, count: 1 });
			this.#messageBytes += Buffer.byteLength(message);
			while (
				this.#entries.length > MAX_ENTRIES ||
				this.#messageBytes > MAX_MESSAGE_BYTES
			) {
				const oldest = this.#entries.shift();
				if (oldest === undefined)
					throw new Error("Runtime log byte count is inconsistent.");
				this.#messageBytes -= Buffer.byteLength(oldest.message);
			}
		}
		this.#revision++;
	}

	clear(): void {
		this.#entries.length = 0;
		this.#messageBytes = 0;
		this.#revision++;
	}

	read(since: number): RuntimeLogSnapshot | null {
		return since === this.#revision
			? null
			: { revision: this.#revision, entries: this.#entries.slice() };
	}
}
