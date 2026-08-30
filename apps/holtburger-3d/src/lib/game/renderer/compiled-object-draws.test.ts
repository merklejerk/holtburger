import { describe, expect, it } from "vitest";
import {
	CompiledObjectDrawStore,
	type CompiledObjectDraw,
	type CompiledObjectDrawFlushReason,
} from "./compiled-object-draws";

const BLEND_POLICY = {
	destination: "one-minus-src-alpha",
	source: "src-alpha",
} as const;

/** Every event that must drop compiled facts, so none can be dropped from the store silently. */
const FLUSH_REASONS: readonly CompiledObjectDrawFlushReason[] = [
	"atlas-publication",
	"texture-filtering",
	"region-static-detail",
	"env-cell-render-mode",
];

describe("CompiledObjectDrawStore", () => {
	it("caches one publication's whole submission set by reference", () => {
		const { store } = createStore();
		const renderable = { id: "landblock-layer" };
		let builds = 0;
		const build = () => {
			builds += 1;
			return [{ id: "draw" }];
		};

		const first = store.resolveNodeSubmissions(renderable, "outdoor", build);
		const second = store.resolveNodeSubmissions(renderable, "outdoor", build);

		expect(second).toBe(first);
		expect(builds).toBe(1);
	});

	it("separates publication submissions from single compiled draws", () => {
		const { store, compile } = createStore();
		// One object can legitimately key both kinds; they must not collide.
		const key = { id: "shared" };
		store.resolveNodeSubmissions(key, "outdoor", () => [{ id: "draw" }]);
		store.resolveDraw(key, "outdoor", compile);

		expect(store.getDiagnostics()).toMatchObject({
			compiledEntryCount: 2,
			totalCompilationCount: 2,
		});
	});

	it("compiles once per draw unit and shares the result by reference", () => {
		const { store, compile, compileCount } = createStore();
		const drawUnit = { id: "wall" };

		const first = store.resolveDraw(drawUnit, "opaque", compile);
		const second = store.resolveDraw(drawUnit, "opaque", compile);

		expect(second).toBe(first);
		expect(compileCount()).toBe(1);
		expect(store.getDiagnostics().compiledEntryCount).toBe(1);
	});

	it("keeps one slot per ordering variant of the same draw unit", () => {
		const { store, compile, compileCount } = createStore();
		const drawUnit = { id: "ghost" };

		// A translucency ramp can hold a part transparent indefinitely, so the promoted ordering
		// must occupy its own slot rather than recompiling against the authored one every frame.
		const opaque = store.resolveDraw(drawUnit, "opaque", compile);
		const transparent = store.resolveDraw(drawUnit, "transparent", compile);
		store.resolveDraw(drawUnit, "transparent", compile);

		expect(transparent).not.toBe(opaque);
		expect(compileCount()).toBe(2);
	});

	it("compiles separately for distinct draw units", () => {
		const { store, compile, compileCount } = createStore();

		store.resolveDraw({ id: "a" }, "opaque", compile);
		store.resolveDraw({ id: "b" }, "opaque", compile);

		expect(compileCount()).toBe(2);
		expect(store.getDiagnostics().compiledEntryCount).toBe(2);
	});

	it.each(FLUSH_REASONS)("recompiles after a %s flush", (reason) => {
		const { store, compile, compileCount } = createStore();
		const drawUnit = { id: "lantern" };
		const renderable = { id: "layer" };
		const before = store.resolveDraw(drawUnit, "opaque", compile);
		const beforeSubmissions = store.resolveNodeSubmissions(
			renderable,
			"outdoor",
			() => [{ id: "draw" }],
		);

		store.flush(reason);
		const after = store.resolveDraw(drawUnit, "opaque", compile);
		const afterSubmissions = store.resolveNodeSubmissions(
			renderable,
			"outdoor",
			() => [{ id: "draw" }],
		);

		// Both cached kinds must drop together: every reason invalidates facts they share.
		expect(after).not.toBe(before);
		expect(afterSubmissions).not.toBe(beforeSubmissions);
		expect(compileCount()).toBe(2);
		expect(store.getDiagnostics().flushCounts[reason]).toBe(1);
	});

	it("reports occupancy and lifetime churn separately", () => {
		const { store, compile } = createStore();
		store.resolveDraw({ id: "a" }, "opaque", compile);
		store.resolveDraw({ id: "b" }, "opaque", compile);
		store.flush("atlas-publication");
		store.resolveDraw({ id: "c" }, "opaque", compile);

		expect(store.getDiagnostics()).toMatchObject({
			compiledEntryCount: 1,
			totalCompilationCount: 3,
			flushCounts: {
				"atlas-publication": 1,
				"env-cell-render-mode": 0,
				"region-static-detail": 0,
				"texture-filtering": 0,
			},
		});
	});
});

function createStore() {
	let compilations = 0;
	const store = new CompiledObjectDrawStore<
		readonly { readonly id: string }[],
		{ readonly id: number }
	>();
	const compile = (): CompiledObjectDraw<{ readonly id: number }> => {
		compilations += 1;
		return {
			batchKey: "compiled-draw:test",
			blendPolicy: BLEND_POLICY,
			compatibility: { id: compilations },
		};
	};
	return { compile, compileCount: () => compilations, store };
}
