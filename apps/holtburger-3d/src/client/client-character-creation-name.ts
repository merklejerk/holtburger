import { z } from "zod";

/** Retail CharGenState::SetName caps the single-byte name at 32 (acclient.c:472085). */
export const MAX_CREATION_NAME_LENGTH = 32;

/** Local retail input screening; ACE's configured bans and name availability remain server-owned.
 * NameInputFilter (acclient.c:156054) accepts letters below U+0100, spaces, apostrophes and
 * hyphens. Keep the Latin-1 bound so unsupported names cannot be replaced during String16L
 * Windows-1252 encoding. DoFinish trims boundary spaces before submission (acclient.c:268758).
 */
export const creationNameSchema = z
	.string()
	.max(
		MAX_CREATION_NAME_LENGTH,
		`Use at most ${MAX_CREATION_NAME_LENGTH} characters.`,
	)
	.refine(
		(name) =>
			[...name].every(
				(character) =>
					character.charCodeAt(0) < 0x100 && /^[\p{L} '-]$/u.test(character),
			),
		"Use Latin letters, spaces, apostrophes, or hyphens.",
	)
	.transform((name) => name.trim())
	.pipe(z.string().min(1, "Enter a character name."));
