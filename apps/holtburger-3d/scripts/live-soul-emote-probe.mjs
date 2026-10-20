import assert from "node:assert/strict";

/** Verify local authored playback and ACE broadcasts through the real host command boundary. */
export async function probeLiveSoulEmotes(
	client,
	waiter,
	latestEntities,
	playerGuid,
	playerName,
	timeoutMs,
) {
	const references = await client.invoke("load_soul_emotes");
	const results = [];
	const submit = (request) => client.invoke("send_client_chat", { request });
	const waitChat = (predicate, description) => {
		const pending = waiter.wait(
			"client-chat-message",
			predicate,
			timeoutMs,
			description,
		);
		void pending.catch(() => undefined);
		return pending;
	};
	for (const token of ["wave", "bow", "waving"]) {
		const reference = references.find((reference) =>
			reference.aliases.includes(token),
		);
		assert.ok(reference, `Mounted soul-emote alias ${token}`);
		const previous =
			latestEntities.get(playerGuid)?.motion?.ordinary?.playbackId;
		const playback = waiter.wait(
			"client-dynamic-entity",
			(payload) => {
				const entities =
					payload.kind === "upserted"
						? [payload.entity]
						: payload.kind === "ticked"
							? [
									...payload.batch.updates,
									...payload.batch.advances.map((advance) => advance.entity),
								]
							: payload.kind === "snapshot"
								? payload.snapshot.entities
								: [];
				return entities.some(
					(entity) =>
						entity.identity.guid === playerGuid &&
						entity.motion?.ordinary !== null &&
						entity.motion?.ordinary !== undefined &&
						entity.motion.ordinary.playbackId !== previous &&
						entity.motion.activity !== "locomotion",
				);
			},
			timeoutMs,
			`${token} authored playback`,
		);
		void playback.catch(() => undefined);
		const broadcast = waitChat(
			(payload) =>
				payload.kind === "soul-emote" &&
				payload.message === reference.otherEmote.replaceAll("%p", "their"),
			`${token} soul-emote broadcast`,
		);
		await submit({ kind: "soul-emote", token });
		const [motion, chat] = await Promise.all([playback, broadcast]);
		results.push({ token, pose: reference.pose, chat, motion });
	}
	const mixedMessage = "Soul-emote mixed speech probe.";
	const speech = waitChat(
		(payload) => payload.kind === "speech" && payload.message === mixedMessage,
		"remaining mixed speech",
	);
	const gesture = waitChat(
		(payload) => payload.kind === "soul-emote" && payload.message === "waves.",
		"mixed wave broadcast",
	);
	await submit({ kind: "soul-emote", token: "wave" });
	await submit({ kind: "speech", message: mixedMessage });
	await Promise.all([speech, gesture]);
	// The local development character must have Sentinel access. Always restore its chat privilege.
	let gagRequested = false;
	try {
		const gagged = waitChat(
			(payload) =>
				payload.message === `${playerName} has been gagged for five minutes.`,
			"self-gag administration acknowledgment (requires Sentinel access)",
		);
		gagRequested = true;
		await submit({ kind: "speech", message: `@gag ${playerName}` });
		await gagged;
		const rejected = waitChat(
			(payload) => payload.message.includes("because you have been gagged"),
			"server gag rejection",
		);
		await submit({ kind: "soul-emote", token: "wave" });
		await rejected;
	} finally {
		if (gagRequested) {
			const restored = waitChat(
				(payload) => payload.message === `${playerName} has been ungagged.`,
				"self-ungag administration acknowledgment",
			);
			await submit({ kind: "speech", message: `@ungag ${playerName}` });
			await restored;
		}
	}
	return {
		catalog: {
			poses: references.length,
			aliases: references.reduce(
				(sum, reference) => sum + reference.aliases.length,
				0,
			),
		},
		executions: results,
		mixedSpeech: true,
		gagRejectedAfterEnqueue: true,
		ungagged: true,
	};
}
