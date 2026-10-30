import { randomUUID } from "node:crypto";

/** Frontend document role is independent of the Rust host's client/Explorer mode. */
export type DocumentRole = "picker" | "client" | "explorer";

/** A fresh document identity prevents delayed requests from reaching a later session in the same window. */
export class DocumentAdmission {
	#document: {
		id: string;
		role: DocumentRole;
		path: string;
	} | null = null;
	#open = false;
	/** The native navigation owner publishes this once, before the next document can boot. */
	get role(): DocumentRole | null {
		return this.#document?.role ?? null;
	}
	navigate(role: DocumentRole, path: string): void {
		this.#document = { id: randomUUID(), role, path: path.split("?", 1)[0] };
		this.#open = true;
	}
	boot(url: string): string {
		const document = this.#document;
		if (
			!document ||
			!this.#open ||
			!new URL(url).pathname.endsWith(`/${document.path}`)
		)
			throw new Error("Document boot is unavailable for this entry");
		return document.id;
	}
	require(id: unknown, role?: DocumentRole): void {
		if (!this.#open) throw new Error("Document request admission is closed");
		this.requireIdentity(id);
		if (role !== undefined && this.#document?.role !== role)
			throw new Error(`Request is unavailable in ${this.#document?.role}`);
	}
	/** Product Quit remains available from the current document after its game IPC is sealed. */
	requireIdentity(id: unknown): void {
		if (!this.#document || id !== this.#document.id)
			throw new Error("Document request admission is closed");
	}
	close(): void {
		this.#open = false;
	}
}
