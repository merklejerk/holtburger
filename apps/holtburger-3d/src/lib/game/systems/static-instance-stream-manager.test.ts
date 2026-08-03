import { describe, expect, it } from "vitest";
import { AABB3 } from "../math/types";
import type { StaticInstanceStreamSource } from "./static-resources";
import { StaticInstanceStreamManager } from "./static-instance-stream-manager";

const SOURCE = {
	data: { instances: [], sourceEnvelope: AABB3.zero() },
	key: "static-instance-stream:static-install:fixture/cohort",
} as const satisfies StaticInstanceStreamSource;

describe("StaticInstanceStreamManager", () => {
	it("preserves immutable fragment data until the final semantic owner releases it", () => {
		const manager = new StaticInstanceStreamManager<"first" | "second">();

		manager.reserveKeys("first", [SOURCE.key]);
		manager.reserveKeys("second", [SOURCE.key]);
		manager.publish(SOURCE);
		manager.publish(SOURCE);

		expect(manager.getData(SOURCE.key)).toBe(SOURCE.data);
		manager.dropOwner("first");
		expect(manager.getData(SOURCE.key)).toBe(SOURCE.data);
		manager.dropOwner("second");
		expect(() => manager.getData(SOURCE.key)).toThrow(
			`Static instance stream ${SOURCE.key} does not exist.`,
		);
	});

	it("does not replace live immutable data but permits key reuse after final release", () => {
		const manager = new StaticInstanceStreamManager<"first" | "replacement">();
		const replacement = { instances: [], sourceEnvelope: AABB3.zero() };

		manager.reserveKeys("first", [SOURCE.key]);
		manager.publish(SOURCE);
		manager.publish({ data: replacement, key: SOURCE.key });
		expect(manager.getData(SOURCE.key)).toBe(SOURCE.data);

		manager.dropOwner("first");
		manager.reserveKeys("replacement", [SOURCE.key]);
		manager.publish({ data: replacement, key: SOURCE.key });
		expect(manager.getData(SOURCE.key)).toBe(replacement);
	});
});
