import { open, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

let temporarySequence = 0;

/** Write and sync a private sibling, then atomically replace the destination. */
export async function replaceLocalFile(
	path: string,
	source: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${process.pid}-${temporarySequence++}`;
	let temporaryCreated = false;
	let replacementError: unknown;
	try {
		const file = await open(temporaryPath, "wx", 0o600);
		temporaryCreated = true;
		try {
			await file.writeFile(source, "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporaryPath, path);
		temporaryCreated = false;
	} catch (error) {
		replacementError = error;
	}
	if (temporaryCreated) {
		try {
			await unlink(temporaryPath);
		} catch (error) {
			if (!isNodeError(error) || error.code !== "ENOENT")
				replacementError ??= error;
		}
	}
	if (replacementError !== undefined) throw replacementError;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
