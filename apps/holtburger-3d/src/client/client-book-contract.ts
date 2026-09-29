import { z } from "zod";

const guid = z.number().int().min(0).max(0xffff_ffff);

/** Reader-facing page facts; null text means the page must be requested. */
const bookPageSchema = z
	.object({
		/** Zero-based identity used for a missing page request. */
		index: guid,
		/** Server-disclosed author for this page. */
		authorName: z.string(),
		/** Null requires a page request; empty string is a loaded blank page. */
		text: z.string().nullable(),
	})
	.strict();

/** Complete current page state projected from the authoritative world entity. */
export const clientBookSchema = z
	.object({
		/** Object identity echoed by book response events. */
		guid,
		/** Actual ordered page entries, independent of book capacity. */
		pages: z.array(bookPageSchema),
		/** Book-level inscription text. */
		inscription: z.string().nullable(),
		/** Book-level scribe signature. */
		authorName: z.string().nullable(),
	})
	.strict();

export const clientBookOpenedSchema = z
	.object({
		/** Entity name captured when the full response was accepted. */
		name: z.string(),
		/** Initial book contents, including any deferred pages. */
		book: clientBookSchema,
	})
	.strict();

export const clientBookPageRequestSchema = z
	.object({
		/** Character identity checked by core before sending. */
		player: guid,
		/** Book that supplied the listed page identity. */
		book: guid,
		/** Zero-based page identity from the full response. */
		pageIndex: guid,
	})
	.strict();

export type ClientBook = z.infer<typeof clientBookSchema>;
export type ClientBookOpened = z.infer<typeof clientBookOpenedSchema>;
export type ClientBookPageRequest = z.infer<typeof clientBookPageRequestSchema>;
