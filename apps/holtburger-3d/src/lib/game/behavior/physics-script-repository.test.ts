import { describe, expect, it } from "vitest";
import type { DecodedPhysicsScript } from "../../assets/decode-physics-script-record";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import type { DatAssetId } from "../game-types";
import {
	AUTHORED_SCRIPT_FIXTURES,
	AUTHORED_SCRIPT_ROOT_IDS,
} from "./authored-script-fixtures";
import { PhysicsScriptRepository } from "./physics-script-repository";

/** Serves the checked-in fixtures and counts loads so preparation sharing is observable. */
class FixtureScriptSource implements PhysicsScriptSource {
	readonly loads: DatAssetId[] = [];
	destroyed = false;

	async loadPhysicsScript(scriptId: DatAssetId): Promise<DecodedPhysicsScript> {
		this.loads.push(scriptId);
		const fixture = AUTHORED_SCRIPT_FIXTURES[scriptId.toLowerCase()];
		if (!fixture) throw new Error(`No fixture for ${scriptId}.`);
		return fixture;
	}

	destroy(): void {
		this.destroyed = true;
	}
}

describe("PhysicsScriptRepository", () => {
	it("derives each script's direct dependencies from its own records", async () => {
		const repository = new PhysicsScriptRepository(new FixtureScriptSource());

		const handle = await repository.acquire("0x33000862");

		expect(handle.asset.dependencies).toEqual({
			emitterInfoIds: ["0x32000478"],
			scriptIds: ["0x33000863"],
			soundIds: [],
		});
		expect(handle.asset.lengthSeconds).toBe(0);
		handle.release();
	});

	it("prepares a self-cycling script exactly once and keeps its cyclic runtime edge", async () => {
		const source = new FixtureScriptSource();
		const repository = new PhysicsScriptRepository(source);

		const closure = await repository.acquireClosure("0x33000711");

		// Traversal terminated, but the record still calls the script it belongs to.
		expect(source.loads).toEqual(["0x33000711"]);
		expect([...closure.scripts.keys()]).toEqual(["0x33000711"]);
		const call = closure.scripts.get("0x33000711")!.records[1]!;
		expect(call).toMatchObject({
			kind: "call-pes",
			pauseSeconds: 0,
			scriptId: "0x33000711",
			startTime: 3,
		});
		closure.release();
	});

	it("stages a root that leads into a cycle rather than being one", async () => {
		const source = new FixtureScriptSource();
		const repository = new PhysicsScriptRepository(source);

		const closure = await repository.acquireClosure("0x330003d8");

		expect([...closure.scripts.keys()].sort()).toEqual([
			"0x330003cc",
			"0x330003d8",
		]);
		expect(source.loads).toHaveLength(2);
		closure.release();
	});

	it("shares one preparation across every root that reaches the same script", async () => {
		const source = new FixtureScriptSource();
		const repository = new PhysicsScriptRepository(source);

		const first = await repository.acquireClosure("0x330003d8");
		const second = await repository.acquireClosure("0x33000253");

		// 0x330003cc is reached by both roots and must not be transferred twice.
		expect(source.loads.filter((id) => id === "0x330003cc")).toHaveLength(1);
		expect(first.scripts.get("0x330003cc")).toBe(
			second.scripts.get("0x330003cc"),
		);
		first.release();
		second.release();
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});

	it("stages every measured representative root without an archive", async () => {
		const repository = new PhysicsScriptRepository(new FixtureScriptSource());

		const closures = await Promise.all(
			AUTHORED_SCRIPT_ROOT_IDS.map((rootId) =>
				repository.acquireClosure(rootId),
			),
		);

		expect(closures).toHaveLength(AUTHORED_SCRIPT_ROOT_IDS.length);
		for (const closure of closures) closure.release();
		expect(repository.getDiagnostics().assetCount).toBe(0);
	});

	it("releases every acquired handle when one dependency cannot stage", async () => {
		const source = new FixtureScriptSource();
		const repository = new PhysicsScriptRepository(source);
		// 0x330003d8 stages, then its 0x330003cc dependency is made unavailable.
		source.loadPhysicsScript = async (scriptId) => {
			source.loads.push(scriptId);
			if (scriptId === "0x330003cc") throw new Error("archive miss");
			return AUTHORED_SCRIPT_FIXTURES[scriptId.toLowerCase()]!;
		};

		await expect(repository.acquireClosure("0x330003d8")).rejects.toThrow(
			"could not stage 0x330003cc",
		);

		// No handle survives a partial closure, so nothing can activate half-staged.
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});
});
