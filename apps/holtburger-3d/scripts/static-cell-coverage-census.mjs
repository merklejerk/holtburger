import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Input is the existing portal_trace_archive export. Use the production decoder,
// materializer and worker so the census cannot invent a second batch geometry path.
const [input, ...extra] = process.argv.slice(2);
if (!input || extra.length !== 0) {
	throw new Error(
		"Usage: npm run probe:static-cell-coverage -- <portal-trace-export.json>",
	);
}
const archive = JSON.parse(await readFile(input, "utf8"));
const vite = await createServer({
	root: fileURLToPath(new URL("../", import.meta.url)),
	configFile: false,
	logLevel: "error",
	server: { middlewareMode: true, watch: null },
	appType: "custom",
});
try {
	const [decoder, materializer, worker, realization, coverage, types] =
		await Promise.all([
			vite.ssrLoadModule("/src/lib/assets/decode-env-cell-record.ts"),
			vite.ssrLoadModule("/src/lib/game/commit/env-cell-materialization.ts"),
			vite.ssrLoadModule(
				"/src/lib/game/commit/static-object-geometry-worker.ts",
			),
			vite.ssrLoadModule("/src/lib/game/runtime/env-cell-realization.ts"),
			vite.ssrLoadModule("/src/lib/game/commit/static-batch-cell-coverage.ts"),
			vite.ssrLoadModule("/src/lib/game/math/types.ts"),
		]);
	const landblocks = [];
	for (const record of archive.records) {
		const source = decoder.decodeEnvCellRecord(
			new Uint8Array(Buffer.from(record.envCellRecordHex, "hex")),
			record.landblockId,
		);
		if (source === null) {
			landblocks.push({
				landblockId: record.landblockId,
				availability: "absent",
			});
			continue;
		}
		const plan = materializer.planEnvCellMaterialization(source);
		const query = new coverage.StaticBatchCellCoverage(
			realization.createEnvCellEnvironmentArtifact(plan),
		);
		const batches = [];
		for (const job of plan.residentJobs) {
			const geometry = worker.prepareStaticObjectGeometry({
				layer: job.source.kind,
				source: job.source,
				resourceNamespace: `static-install:census/${job.source.envCellId}`,
			});
			if (geometry === null) continue;
			for (const [index, object] of geometry.objects.entries()) {
				const membership = query.resolve(
					{
						landblockId: source.landblockId,
						envCellId: job.source.envCellId,
						localTransform: types.Mat4.identity(),
					},
					object.bounds,
				);
				batches.push({
					id: `${job.id}/${index}`,
					owner: job.source.envCellId,
					coveredCells: membership.scopes.map((s) => s.envCellId),
					residentCount: job.source.staticResidents.length,
					drawRangeCount: object.drawUnits.length,
					bakedTriangles: object.drawUnits.reduce(
						(count, draw) => count + draw.indexCount / 3,
						0,
					),
				});
			}
		}
		landblocks.push({
			landblockId: source.landblockId,
			availability: "present",
			cellCount: plan.scopes.length,
			staticResidentCount: plan.residentJobs.reduce(
				(count, job) => count + job.source.staticResidents.length,
				0,
			),
			pointHullExcludedCells: plan.scopes
				.filter((c) => c.containmentPlanes === null)
				.map((c) => c.scope.envCellId),
			emptyHullCells: plan.scopes
				.filter((c) => c.containmentPlanes?.length === 0)
				.map((c) => c.scope.envCellId),
			missingShellBoundsCells: plan.scopes
				.filter((c) => c.landblockBounds === null)
				.map((c) => c.scope.envCellId),
			rotatedCellCount: plan.scopes.filter((c) => {
				const m = c.structureToLandblock;
				return (
					Math.abs(m.m11 - 1) + Math.abs(m.m22 - 1) + Math.abs(m.m33 - 1) >
					0.00001
				);
			}).length,
			batchCount: batches.length,
			expandedBatchCount: batches.filter((b) => b.coveredCells.length > 1)
				.length,
			batches,
		});
	}
	process.stdout.write(
		JSON.stringify(
			{
				method:
					"Production baked batch bounds; recursive same-island coverage using authored cell hulls. Counts are source ranges/triangles, not final GPU submissions.",
				landblocks,
			},
			null,
			2,
		) + "\n",
	);
} finally {
	await vite.close();
}
