import { describe, expect, it } from "vitest";
import {
	addTransferableArrayBuffer,
	addTransferableBinarySidecar,
	collectTransferableArrayBuffers,
	collectTransferableBinarySidecars,
} from "./transfers";

describe("worker transfer helpers", () => {
	it("collects each full typed-array ArrayBuffer once", () => {
		const first = new Uint8Array([1, 2, 3]);
		const second = new Uint16Array([4, 5]);

		expect(collectTransferableArrayBuffers([first, first, second])).toEqual([
			first.buffer,
			second.buffer,
		]);
	});

	it("rejects partial typed-array views by default", () => {
		const source = new Uint8Array([1, 2, 3, 4]);
		const partial = source.subarray(1, 3);

		expect(() =>
			collectTransferableArrayBuffers([partial], {
				label: "fixture pixels",
			}),
		).toThrow(
			"fixture pixels: partial typed-array views are not transferable by default.",
		);
	});

	it("can deliberately skip partial views", () => {
		const source = new Uint8Array([1, 2, 3, 4]);
		const partial = source.subarray(1, 3);

		expect(
			collectTransferableArrayBuffers([partial], {
				partialViewPolicy: "skip",
			}),
		).toEqual([]);
	});

	it("reports whether a view was added", () => {
		const buffers = new Set<ArrayBuffer>();
		const source = new Uint8Array([1, 2, 3, 4]);
		const partial = source.subarray(1, 3);

		expect(addTransferableArrayBuffer(buffers, source)).toBe(true);
		expect(
			addTransferableArrayBuffer(buffers, partial, {
				partialViewPolicy: "skip",
			}),
		).toBe(false);
		expect([...buffers]).toEqual([source.buffer]);
	});

	it("collects owned binary sidecar views", () => {
		const first = new Uint8Array([1, 2, 3]);
		const second = new Float32Array([4, 5]);

		expect(
			collectTransferableBinarySidecars([
				{
					label: "first fixture sidecar",
					ownership: "owned-transferable",
					view: first,
				},
				{
					label: "second fixture sidecar",
					ownership: "owned-transferable",
					view: second,
				},
			]),
		).toEqual([first.buffer, second.buffer]);
	});

	it("rejects borrowed binary sidecar views", () => {
		const source = new Uint8Array([1, 2, 3]);

		expect(() =>
			collectTransferableBinarySidecars([
				{
					label: "borrowed fixture sidecar",
					ownership: "borrowed",
					view: source,
				},
			]),
		).toThrow(
			"borrowed fixture sidecar: borrowed typed-array views are not transferable.",
		);
	});

	it("reports whether an owned binary sidecar view was added", () => {
		const buffers = new Set<ArrayBuffer>();
		const source = new Uint8Array([1, 2, 3]);

		expect(
			addTransferableBinarySidecar(buffers, {
				label: "fixture sidecar",
				ownership: "owned-transferable",
				view: source,
			}),
		).toBe(true);
		expect([...buffers]).toEqual([source.buffer]);
	});
});
