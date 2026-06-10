import type { StaticResolverClient } from "../contracts";
import type {
	StaticResolverWorkerRequest,
	StaticResolverWorkerResponse,
} from "./protocol";

export async function handleStaticResolverWorkerRequest(
	resolver: StaticResolverClient,
	message: StaticResolverWorkerRequest,
	postMessage: (response: StaticResolverWorkerResponse) => void,
): Promise<void> {
	if (message.kind !== "resolve-static-scope") {
		return;
	}

	try {
		const payload = await resolver.resolve(message.request);
		postMessage({
			kind: "static-scope-resolved",
			payload,
			requestId: message.requestId,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "static-scope-resolve-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
