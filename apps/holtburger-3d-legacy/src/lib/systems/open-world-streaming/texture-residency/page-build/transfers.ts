import type { OpenWorldTexturePageBuildOutput } from "./protocol";

export function collectOpenWorldTexturePageBuildTransfers(
	output: OpenWorldTexturePageBuildOutput,
): readonly Transferable[] {
	if (output.kind === "noop") {
		return [];
	}
	return [output.page.pixels.buffer];
}
