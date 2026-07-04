export type PartialTypedArrayTransferPolicy = "reject" | "skip";

export interface TransferableViewOptions {
	readonly label?: string;
	readonly partialViewPolicy?: PartialTypedArrayTransferPolicy;
}

export function collectTransferableArrayBuffers(
	views: Iterable<ArrayBufferView>,
	options: TransferableViewOptions = {},
): readonly Transferable[] {
	const buffers = new Set<ArrayBuffer>();
	for (const view of views) {
		addTransferableArrayBuffer(buffers, view, options);
	}
	return [...buffers];
}

export function addTransferableArrayBuffer(
	buffers: Set<ArrayBuffer>,
	view: ArrayBufferView,
	options: TransferableViewOptions = {},
): boolean {
	const buffer = view.buffer;
	if (!(buffer instanceof ArrayBuffer)) {
		return handleRejectedView(
			options,
			"shared array buffers are not transferable",
		);
	}
	if (view.byteOffset !== 0 || view.byteLength !== buffer.byteLength) {
		return handleRejectedView(
			options,
			"partial typed-array views are not transferable by default",
		);
	}
	buffers.add(buffer);
	return true;
}

function handleRejectedView(
	options: TransferableViewOptions,
	reason: string,
): false {
	if (options.partialViewPolicy === "skip") {
		return false;
	}
	const label =
		options.label === undefined ? "Typed-array view" : options.label;
	throw new Error(`${label}: ${reason}.`);
}
