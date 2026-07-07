export type BrowserRuntimePipelineMode = "legacy" | "open-world-streaming";

export const DEFAULT_BROWSER_RUNTIME_PIPELINE: BrowserRuntimePipelineMode =
	"open-world-streaming";

export function parseBrowserRuntimePipelineMode(
	value: string | null | undefined,
): BrowserRuntimePipelineMode {
	if (value === undefined || value === null || value.length === 0) {
		return DEFAULT_BROWSER_RUNTIME_PIPELINE;
	}
	if (value === "legacy" || value === "open-world-streaming") {
		return value;
	}
	throw new Error(
		`Unsupported browser runtime pipeline "${value}". Expected legacy or open-world-streaming.`,
	);
}
