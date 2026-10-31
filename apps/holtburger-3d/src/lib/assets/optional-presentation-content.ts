import { isContentFailure } from "../host/host-command-result";

/** Omit one explicitly optional presentation operation; contract and lifecycle faults still reject. */
export async function optionalPresentationContent<T>(
	operation: Promise<T>,
	label: string,
	report: (error: Error) => void,
): Promise<T | null> {
	try {
		return await operation;
	} catch (cause) {
		if (!isContentFailure(cause)) throw cause;
		report(new Error(`${label} unavailable; presentation omitted.`, { cause }));
		return null;
	}
}
