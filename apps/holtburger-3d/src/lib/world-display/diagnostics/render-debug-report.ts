interface RenderDebugReportRow {
	label: string;
	value: string;
}

interface RenderDebugReportSection {
	title: string;
	rows: readonly RenderDebugReportRow[];
}

interface RenderDebugReportRuntimeAppearancePreview {
	id: string;
	setupModelId: number;
	appearanceKey: string;
}

export interface RenderDebugReportInput {
	generatedAtIso: string;
	destinationFocusLabel: string;
	sceneSummaryRows: readonly RenderDebugReportRow[];
	sceneDetailSections: readonly RenderDebugReportSection[];
	debugSummaryRows: readonly RenderDebugReportRow[];
	debugDetailSections: readonly RenderDebugReportSection[];
	pickerSections: readonly RenderDebugReportSection[];
	runtimeAppearanceStatusText: string;
	runtimeAppearanceRows: readonly RenderDebugReportRow[];
	runtimeAppearancePayload: {
		pending: boolean;
		error: string | null;
		input: unknown;
		previews: readonly RenderDebugReportRuntimeAppearancePreview[];
	};
}

export function buildRenderDebugReport(input: RenderDebugReportInput): string {
	const lines: string[] = [
		"Holtburger 3D Debug Report",
		`Generated: ${input.generatedAtIso}`,
		`Destination: ${input.destinationFocusLabel}`,
		"",
		formatReportRows("Scene Summary", input.sceneSummaryRows),
		formatReportSections("Scene Details", input.sceneDetailSections),
		formatReportRows("Debug Summary", input.debugSummaryRows),
		formatReportSections("Debug Details", input.debugDetailSections),
		formatReportSections("Picker", input.pickerSections),
		"Runtime Appearance",
		input.runtimeAppearanceStatusText,
		formatReportRows("Runtime Appearance Rows", input.runtimeAppearanceRows),
		formatReportJson(input.runtimeAppearancePayload),
	];
	return lines.join("\n");
}

function formatReportRows(
	title: string,
	rows: readonly RenderDebugReportRow[],
): string {
	return [title, ...rows.map((row) => `${row.label}: ${row.value}`), ""].join(
		"\n",
	);
}

function formatReportSections(
	title: string,
	sections: readonly RenderDebugReportSection[],
): string {
	return [
		title,
		...sections.flatMap((section) => [
			`[${section.title}]`,
			...section.rows.map((row) => `${row.label}: ${row.value}`),
			"",
		]),
	].join("\n");
}

function formatReportJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? "null";
}
