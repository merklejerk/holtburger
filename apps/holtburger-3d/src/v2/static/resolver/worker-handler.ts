import type { StaticResolver } from "../contracts";
import type {
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerResponse,
} from "./protocol";

export async function handleStaticResolverWorkerRequest(
	resolver: StaticResolver,
	message: StaticResolverWorkerMainMessage,
	postMessage: (response: StaticResolverWorkerResponse) => void,
): Promise<void> {
	if (message.kind !== "resolve-static-scope") {
		return;
	}

	try {
		const payload = await resolver.resolve(message.job);
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
