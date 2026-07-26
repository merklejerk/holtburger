import { describe, expect, it } from "vitest";
import type {
	InstanceStreamResourceKey,
	RendererResourceManager,
} from "../renderer/resource-manager";
import type { StaticInstanceStreamSource } from "./static-resources";
import { StaticInstanceStreamManager } from "./static-instance-stream-manager";

const SOURCE = {
	data: { instances: [] },
	key: "static-instance-stream:static-install:fixture/cohort",
} as const satisfies StaticInstanceStreamSource;
const RESOURCE = "instance-stream-resource:1" as InstanceStreamResourceKey;

describe("StaticInstanceStreamManager", () => {
	it("preserves publish-once resources until the final semantic owner releases them", () => {
		const created: StaticInstanceStreamSource["data"][] = [];
		const released: InstanceStreamResourceKey[] = [];
		const resources = {
			createStaticInstanceStream: (
				data: StaticInstanceStreamSource["data"],
			) => {
				created.push(data);
				return RESOURCE;
			},
			releaseResource: (key: InstanceStreamResourceKey) => {
				released.push(key);
				return true;
			},
		} as unknown as RendererResourceManager;
		const manager = new StaticInstanceStreamManager<"first" | "second">(
			resources,
		);

		manager.reserveKeys("first", [SOURCE.key]);
		manager.reserveKeys("second", [SOURCE.key]);
		manager.publish(SOURCE);
		manager.publish(SOURCE);

		expect(created).toEqual([SOURCE.data]);
		expect(manager.getResource(SOURCE.key)).toBe(RESOURCE);
		manager.dropOwner("first");
		expect(released).toEqual([]);
		manager.dropOwner("second");
		expect(released).toEqual([RESOURCE]);
	});
});
