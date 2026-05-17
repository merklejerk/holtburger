import { describe, expect, it } from "vitest";

import type { Vec3Dto } from "../host/contracts";
import type { RenderChunkTransform } from "./render-anchor";
import {
	syncRenderChunkRootRecords,
	type RenderChunkRootAdapter,
	type RenderChunkRootRecord,
} from "./chunk-root-manager";

interface TestRoot {
	name: string;
	position: Vec3Dto;
	disposed: boolean;
}

describe("syncRenderChunkRootRecords", () => {
	it("creates one root per active chunk and updates positions on rebase", () => {
		const records = new Map<
			RenderChunkTransform["chunkKey"],
			RenderChunkRootRecord<TestRoot>
		>();
		const createdRoots: TestRoot[] = [];
		const adapter: RenderChunkRootAdapter<TestRoot> = {
			createRoot: (nextTransform) => {
				const root = {
					name: nextTransform.chunkKey,
					position: { x: 0, y: 0, z: 0 },
					disposed: false,
				};
				createdRoots.push(root);
				return root;
			},
			updateRootPosition: (root, offset) => {
				root.position = offset;
			},
			disposeRoot: (root) => {
				root.disposed = true;
			},
		};

		syncRenderChunkRootRecords(
			records,
			[transform("landblock/da55ffff", 0, 0)],
			adapter,
		);
		syncRenderChunkRootRecords(
			records,
			[transform("landblock/da55ffff", -192, 0)],
			{
				createRoot: () => {
					throw new Error("existing chunk root should be reused");
				},
				updateRootPosition: (root, offset) => {
					root.position = offset;
				},
				disposeRoot: (root) => {
					root.disposed = true;
				},
			},
		);

		expect(createdRoots).toHaveLength(1);
		expect(createdRoots[0]?.position).toEqual({ x: -192, y: 0, z: 0 });
		expect(createdRoots[0]?.disposed).toBe(false);
	});

	it("removes empty chunk roots without touching retained roots", () => {
		const records = new Map<
			RenderChunkTransform["chunkKey"],
			RenderChunkRootRecord<TestRoot>
		>();
		const roots = new Map<string, TestRoot>();
		const adapter = {
			createRoot: (nextTransform: RenderChunkTransform) => {
				const root = {
					name: nextTransform.chunkKey,
					position: { x: 0, y: 0, z: 0 },
					disposed: false,
				};
				roots.set(nextTransform.chunkKey, root);
				return root;
			},
			updateRootPosition: (root: TestRoot, offset: Vec3Dto) => {
				root.position = offset;
			},
			disposeRoot: (root: TestRoot) => {
				root.disposed = true;
			},
		};

		syncRenderChunkRootRecords(
			records,
			[
				transform("landblock/da55ffff", 0, 0),
				transform("landblock/db55ffff", 192, 0),
			],
			adapter,
		);
		syncRenderChunkRootRecords(
			records,
			[transform("landblock/db55ffff", 0, 0)],
			adapter,
		);

		expect(records.has("landblock/da55ffff")).toBe(false);
		expect(records.has("landblock/db55ffff")).toBe(true);
		expect(roots.get("landblock/da55ffff")?.disposed).toBe(true);
		expect(roots.get("landblock/db55ffff")?.disposed).toBe(false);
		expect(roots.get("landblock/db55ffff")?.position).toEqual({
			x: 0,
			y: 0,
			z: 0,
		});
	});
});

function transform(
	chunkKey: RenderChunkTransform["chunkKey"],
	x: number,
	z: number,
): RenderChunkTransform {
	return {
		chunkKey,
		chunkLandblockId: Number.parseInt(chunkKey.slice("landblock/".length), 16),
		offset: { x, y: 0, z },
	};
}
