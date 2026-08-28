/**
 * Supplies the immediate non-rendering world-reveal edge required by the desktop host composition.
 * The interactive client waits for its first pure destination frame. This probe has no renderer,
 * so its caller waits for the portal snapshot and first collision-backed camera path instead.
 *
 * @param {{ invoke(command: string, args: { worldGeneration: number }): Promise<unknown> }} client
 * @param {{ kind?: unknown, worldGeneration?: unknown, cause?: unknown } | null | undefined} lifecycle
 * @returns {Promise<number>}
 */
export async function acknowledgeProbeWorldReveal(client, lifecycle) {
	if (
		lifecycle?.kind !== "portal-space" ||
		typeof lifecycle.worldGeneration !== "number" ||
		!Number.isSafeInteger(lifecycle.worldGeneration) ||
		lifecycle.worldGeneration < 0
	) {
		throw new Error(
			"live client probe cannot acknowledge an invalid portal-space lifecycle",
		);
	}
	await client.invoke("acknowledge_client_world_reveal", {
		worldGeneration: lifecycle.worldGeneration,
	});
	return lifecycle.worldGeneration;
}
