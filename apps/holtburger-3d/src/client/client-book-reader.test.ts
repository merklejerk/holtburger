import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOK_PAGE_TIMEOUT_MS, ClientBookReader } from "./client-book-reader";
import type { ClientBook, ClientBookOpened } from "./client-book-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

function fixture() {
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const requests: { player: number; book: number; pageIndex: number }[] = [];
	let lifecycle: "in-world" | "character-selection" = "in-world";
	const session = {
		state: () => ({ playerGuid: 1, lifecycle: { kind: lifecycle } }),
		subscribe: (listener: (event: ClientLifecycleSessionEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		readBookPage: async (request: (typeof requests)[number]) => {
			requests.push(request);
		},
	} as unknown as ConstructorParameters<typeof ClientBookReader>[0];
	const reader = new ClientBookReader(session);
	const emit = (event: ClientLifecycleSessionEvent) => {
		if (event.type === "lifecycle")
			lifecycle =
				event.lifecycle.kind === "in-world"
					? "in-world"
					: "character-selection";
		for (const listener of listeners) listener(event);
	};
	return { reader, emit, requests };
}

const opened: ClientBookOpened = {
	name: "Journal",
	book: {
		guid: 42,
		pages: [
			{ index: 0, authorName: "Alice", text: "First" },
			{ index: 1, authorName: "Bob", text: null },
			{ index: 2, authorName: "", text: null },
		],
		inscription: "A note",
		authorName: "Alice",
	},
};

afterEach(() => vi.useRealTimers());

describe("book reader", () => {
	it("requests missing pages in order and reveals only the complete document", () => {
		const { reader, emit, requests } = fixture();
		emit({ type: "book-opened", receipt: opened });
		expect(reader.read().kind).toBe("loading");
		expect(requests).toEqual([{ player: 1, book: 42, pageIndex: 1 }]);
		const first: ClientBook = {
			...opened.book,
			pages: opened.book.pages.map((page) =>
				page.index === 1 ? { ...page, text: "Second" } : page,
			),
		};
		emit({ type: "book-updated", book: first });
		expect(requests.map((request) => request.pageIndex)).toEqual([1, 2]);
		expect(reader.read().kind).toBe("loading");
		emit({
			type: "book-updated",
			book: {
				...first,
				pages: first.pages.map((page) =>
					page.index === 2 ? { ...page, text: "" } : page,
				),
			},
		});
		expect(reader.read().kind).toBe("ready");
		reader.destroy();
	});

	it("does not reopen after close or accept pages from another book", () => {
		const { reader, emit } = fixture();
		emit({ type: "book-opened", receipt: opened });
		emit({ type: "book-updated", book: { ...opened.book, guid: 99 } });
		expect(reader.read().kind).toBe("loading");
		reader.close();
		emit({ type: "book-updated", book: opened.book });
		expect(reader.read()).toEqual({ kind: "idle" });
		reader.destroy();
	});

	it("times out, retries the missing page, and replaces an open book", () => {
		vi.useFakeTimers();
		const { reader, emit, requests } = fixture();
		emit({ type: "book-opened", receipt: opened });
		vi.advanceTimersByTime(BOOK_PAGE_TIMEOUT_MS);
		expect(reader.read().kind).toBe("failed");
		reader.retry();
		expect(requests.map((request) => request.pageIndex)).toEqual([1, 1]);
		emit({
			type: "book-opened",
			receipt: {
				name: "Empty",
				book: { ...opened.book, guid: 43, pages: [] },
			},
		});
		expect(reader.read().kind).toBe("ready");
		vi.advanceTimersByTime(BOOK_PAGE_TIMEOUT_MS);
		expect(reader.read().kind).toBe("ready");
		reader.destroy();
	});

	it("keeps a book through teleport and retires it on character selection", () => {
		const { reader, emit } = fixture();
		emit({ type: "book-opened", receipt: opened });
		emit({
			type: "lifecycle",
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 2,
				cause: "teleport",
			},
		});
		expect(reader.read().kind).toBe("loading");
		emit({
			type: "lifecycle",
			lifecycle: { kind: "character-selection", characters: [] },
		});
		emit({ type: "book-updated", book: opened.book });
		emit({ type: "book-opened", receipt: opened });
		expect(reader.read()).toEqual({ kind: "idle" });
		reader.destroy();
	});

	it("retry skips pages that arrived after a timeout", () => {
		vi.useFakeTimers();
		const { reader, emit, requests } = fixture();
		emit({ type: "book-opened", receipt: opened });
		vi.advanceTimersByTime(BOOK_PAGE_TIMEOUT_MS);
		emit({
			type: "book-updated",
			book: {
				...opened.book,
				pages: opened.book.pages.map((page) =>
					page.index === 1 ? { ...page, text: "Arrived late" } : page,
				),
			},
		});
		reader.retry();
		expect(requests.map((request) => request.pageIndex)).toEqual([1, 2]);
		reader.destroy();
	});
});
