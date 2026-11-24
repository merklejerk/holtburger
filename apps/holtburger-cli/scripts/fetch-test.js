HB.onEvent((event) => {
	if (event.kind !== "started") {
		return;
	}

	(async () => {
		HB.print("starting postJson smoke test", "info");

		const [firstResult, secondResult] = await Promise.allSettled([
			HB.postJson({
				url: "https://httpbin.org/post",
				bodyJson: {
					kind: "postJson-smoke-test",
					source: "holtburger",
					values: [1, 2, 3],
				},
			}),
			HB.postJson({
				url: "http://httpbin.org/anything",
				bodyJson: {
					kind: "postJson-smoke-test",
					source: "holtburger",
					values: [4, 5, 6],
				},
			}),
		]);

		for (const [label, result] of [
			["first", firstResult],
			["second", secondResult],
		]) {
			if (result.status === "fulfilled") {
				HB.print(
					`${label} ${result.value.status} ok=${result.value.ok} body=${JSON.stringify(result.value.bodyJson)}`,
					"info",
				);
				continue;
			}

			const error = result.reason;
			const code =
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "unknown";
			const message = error instanceof Error ? error.message : String(error);
			HB.print(`${label} failed (${code}): ${message}`, "error");
		}

		HB.print("postJson smoke test complete", "info");
	})().catch((error) => {
		const code =
			error && typeof error === "object" && "code" in error
				? String(error.code)
				: "unknown";
		const message = error instanceof Error ? error.message : String(error);
		HB.print(`postJson smoke test failed (${code}): ${message}`, "error");
	});
});
