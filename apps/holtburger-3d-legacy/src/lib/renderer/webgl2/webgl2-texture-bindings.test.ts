import { describe, expect, it } from "vitest";
import { createTextureBindingId } from "../../textures/identity";
import type { TextureBindingId } from "../../textures/identity";
import type { TexturePlacementUpdate } from "../types";
import { Webgl2RendererTextureBindingTable } from "./webgl2-texture-bindings";

describe("WebGL2 renderer texture binding table", () => {
	it("treats unknown bindings as pending", () => {
		const table = new Webgl2RendererTextureBindingTable();
		const bindingId = createTestBindingId("missing");

		expect(table.getState(bindingId)).toEqual({
			bindingId,
			kind: "pending",
		});
		expect(table.getResident(bindingId)).toBeNull();
	});

	it("records resident bindings after placement updates", () => {
		const table = new Webgl2RendererTextureBindingTable();
		const bindingId = createTestBindingId("resident");
		const texture = createTexture();

		const change = table.applyPlacementUpdate(
			createTexturePlacementUpdate(bindingId, "resident-ref"),
			{
				createTexture: () => texture,
				deleteTexture: () => undefined,
			},
		);

		expect(change.changed).toBe(true);
		expect(table.getTexture("resident-ref")).toBe(texture);
		expect(table.getState(bindingId)).toMatchObject({
			bindingId,
			kind: "resident",
		});
		expect(table.getResident(bindingId)).toMatchObject({
			bindingId,
			texture,
		});
	});

	it("marks removed texture-ref bindings pending and deletes GPU textures", () => {
		const table = new Webgl2RendererTextureBindingTable();
		const bindingId = createTestBindingId("removed");
		const texture = createTexture();
		const deletedTextures: WebGLTexture[] = [];

		table.applyPlacementUpdate(
			createTexturePlacementUpdate(bindingId, "removed-ref"),
			{
				createTexture: () => texture,
				deleteTexture: (deletedTexture) => {
					deletedTextures.push(deletedTexture);
				},
			},
		);

		const change = table.applyPlacementUpdate(
			{
				bindingReadinessUpdates: [],
				placements: [],
				removedTextureRefIds: ["removed-ref"],
				resolvedTexturePlacements: [],
				revision: 2,
			},
			{
				createTexture: () => {
					throw new Error("remove-only update must not create textures");
				},
				deleteTexture: (deletedTexture) => {
					deletedTextures.push(deletedTexture);
				},
			},
		);

		expect(change.changed).toBe(true);
		expect(deletedTextures).toEqual([texture]);
		expect(table.getTexture("removed-ref")).toBeNull();
		expect(table.getState(bindingId)).toEqual({
			bindingId,
			kind: "pending",
		});
		expect(table.getResident(bindingId)).toBeNull();
	});

	it("records failed bindings as non-resident", () => {
		const table = new Webgl2RendererTextureBindingTable();
		const bindingId = createTestBindingId("failed");

		table.markFailed(bindingId, "decode failed");

		expect(table.getState(bindingId)).toEqual({
			bindingId,
			kind: "failed",
			reason: "decode failed",
		});
		expect(table.getResident(bindingId)).toBeNull();
	});

	it("applies readiness-only updates without creating GPU textures", () => {
		const table = new Webgl2RendererTextureBindingTable();
		const pendingBindingId = createTestBindingId("pending-update");
		const failedBindingId = createTestBindingId("failed-update");
		const missingBindingId = createTestBindingId("missing-update");

		const change = table.applyPlacementUpdate(
			{
				bindingReadinessUpdates: [
					{
						bindingId: pendingBindingId,
						kind: "pending",
						reason: "page-building",
					},
					{
						bindingId: failedBindingId,
						kind: "failed",
						reason: "page build failed",
					},
					{
						bindingId: missingBindingId,
						kind: "missing-not-in-flight",
						reason: "binding was not scheduled",
					},
				],
				placements: [],
				removedTextureRefIds: [],
				resolvedTexturePlacements: [],
				revision: 3,
			},
			{
				createTexture: () => {
					throw new Error("readiness-only update must not create textures");
				},
				deleteTexture: () => undefined,
			},
		);

		expect(change.changed).toBe(true);
		expect(table.getState(pendingBindingId)).toEqual({
			bindingId: pendingBindingId,
			kind: "pending",
			reason: "page-building",
		});
		expect(table.getState(failedBindingId)).toEqual({
			bindingId: failedBindingId,
			kind: "failed",
			reason: "page build failed",
		});
		expect(table.getState(missingBindingId)).toEqual({
			bindingId: missingBindingId,
			kind: "missing-not-in-flight",
			reason: "binding was not scheduled",
		});
	});
});

function createTexturePlacementUpdate(
	textureBindingId: TextureBindingId,
	textureRefId: string,
): TexturePlacementUpdate {
	return {
		bindingReadinessUpdates: [],
		placements: [
			{
				anisotropy: 1,
				bindingId: textureBindingId,
				filteringMode: "nearest",
				format: "rgba8",
				height: 1,
				mipmapsGenerated: false,
				pageVersion: {
					placementRevision: 1,
					textureRefId,
				},
				pixels: new Uint8Array([255, 255, 255, 255]),
				placementRevision: 1,
				rect: [0, 0, 1, 1],
				sampleClass: "rgba-color",
				samplerPolicyKey: "sample=rgba-color;filter=nearest;mips=off;aniso=1",
				textureRefId,
				width: 1,
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			},
		],
		removedTextureRefIds: [],
		resolvedTexturePlacements: [
			{
				bindingId: textureBindingId,
				pageVersion: {
					placementRevision: 1,
					textureRefId,
				},
				rect: [0, 0, 1, 1],
				textureHeight: 1,
				textureRefId,
				textureWidth: 1,
			},
		],
		revision: 1,
	};
}

function createTestBindingId(slot: string): TextureBindingId {
	return createTextureBindingId({
		resourceId: "texture-binding-table-test",
		role: "object-base-color",
		slot,
	});
}

function createTexture(): WebGLTexture {
	return {} as WebGLTexture;
}
