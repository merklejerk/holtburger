import { describe, expect, it } from "vitest";
import { FIRST_RUNTIME_SPAWN_FIXTURE } from "../runtime/runtime-spawn-fixtures";
import {
	DEFAULT_WEENIE_SPAWN_SEEDS,
	createInMemoryWeenieSpawnSeedResolver,
} from "./weenie-spawn-seed-resolver";

describe("weenie spawn seed resolver", () => {
	it("resolves the first ACE-backed fake fixture by WCID", () => {
		const resolver = createInMemoryWeenieSpawnSeedResolver();

		expect(resolver.resolve(FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId)).toEqual(
			{
				label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
				setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
				weenieClassId: FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId,
			},
		);
		expect(DEFAULT_WEENIE_SPAWN_SEEDS).toHaveLength(1);
	});

	it("returns no result for unknown WCIDs", () => {
		const resolver = createInMemoryWeenieSpawnSeedResolver();

		expect(resolver.resolve(999_999)).toBeNull();
	});
});
