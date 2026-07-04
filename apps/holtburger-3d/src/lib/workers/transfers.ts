type PartialTypedArrayTransferPolicy = "reject" | "skip";

export type BinaryTransferOwnership = "borrowed" | "owned-transferable";

export interface BinarySidecarView<TView extends ArrayBufferView = ArrayBufferView> {
	/** Human-readable transfer label used in errors and diagnostics. */
	readonly label: string;
	/** Whether this DTO owns the bytes strongly enough to transfer the backing buffer. */
	readonly ownership: BinaryTransferOwnership;
	/** Typed-array view carrying binary payload bytes. */
	readonly view: TView;
}

export interface TransferableViewOptions {
	readonly label?: string;
	readonly partialViewPolicy?: PartialTypedArrayTransferPolicy;
}

export function collectTransferableBinarySidecars(
	sidecars: Iterable<BinarySidecarView>,
	options: Omit<TransferableViewOptions, "label"> = {},
): readonly Transferable[] {
	const buffers = new Set<ArrayBuffer>();
	for (const sidecar of sidecars) {
		addTransferableBinarySidecar(buffers, sidecar, options);
	}
	return [...buffers];
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

export function addTransferableBinarySidecar(
	buffers: Set<ArrayBuffer>,
	sidecar: BinarySidecarView,
	options: Omit<TransferableViewOptions, "label"> = {},
): boolean {
	if (sidecar.ownership === "borrowed") {
		throw new Error(
			`${sidecar.label}: borrowed typed-array views are not transferable.`,
		);
	}
	return addTransferableArrayBuffer(buffers, sidecar.view, {
		...options,
		label: sidecar.label,
	});
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
