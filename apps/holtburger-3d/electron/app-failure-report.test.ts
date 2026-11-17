import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppFailureReportStore } from "./app-failure-report";

const context = { version: "test", document: "client" };
const drawWarning =
	"WebGL: INVALID_OPERATION: drawArrays: no valid shader program in use";

it("preserves the warnings around the renderer failure across a later process report", async () => {
	const directory = await mkdtemp(join(tmpdir(), "h3d-failure-report-"));
	const store = new AppFailureReportStore(join(directory, "last-failure.json"));
	const first = new Date("2026-01-01T00:00:00Z");
	const last = new Date("2026-01-01T00:00:01Z");
	try {
		vi.setSystemTime(first);
		store.recordWebGLWarning(drawWarning);
		store.recordWebGLWarning("Unrelated renderer warning");
		vi.setSystemTime(last);
		store.recordWebGLWarning(drawWarning);
		const evidence = { reason: "Before geometry upload: WebGL error 0x502." };
		await store.save(
			"renderer",
			store.retainRendererEvidence(JSON.stringify(evidence)),
			context,
		);
		store.recordWebGLWarning("WebGL: CONTEXT_LOST_WEBGL: context lost");
		await store.save("process", "GPU process stopped.", context);
		expect(JSON.parse((await store.read()) ?? "null")).toMatchObject({
			renderer: evidence,
			webglWarnings: [
				{
					message: drawWarning,
					firstSeenAt: first.toISOString(),
					lastSeenAt: last.toISOString(),
					count: 2,
				},
			],
		});

		store.beginDocument();
		await store.save("startup", "Another document failed to start.", context);
		expect(JSON.parse((await store.read()) ?? "null")).toMatchObject({
			renderer: null,
			webglWarnings: [],
		});
	} finally {
		vi.useRealTimers();
		await rm(directory, { recursive: true, force: true });
	}
});

it("keeps recent distinct warnings when a document logs a burst of WebGL errors", async () => {
	const directory = await mkdtemp(join(tmpdir(), "h3d-failure-report-"));
	const store = new AppFailureReportStore(join(directory, "last-failure.json"));
	const latest = "WebGL: INVALID_VALUE: latest operation";
	try {
		store.recordWebGLWarning(drawWarning);
		for (let index = 0; index < 100; index++)
			store.recordWebGLWarning(`WebGL: INVALID_VALUE: operation ${index}`);
		store.recordWebGLWarning(latest);
		await store.save("process", "GPU process stopped.", context);
		const report = await store.read();
		expect(report).toContain(latest);
		expect(report).not.toContain(drawWarning);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
