/** Normalize the binary shapes returned by a desktop host boundary. */
export function asHostBinary(value: unknown, description: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new Error(`${description} returned a non-binary response.`);
}
