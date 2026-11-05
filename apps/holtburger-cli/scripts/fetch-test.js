HB.onEvent((event) => {
	if (event.kind !== "lifecycle" || event.data.kind !== "started") {
		return;
	}

	(async () => {
		HB.print("info", "starting postJson smoke test");

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
					"info",
					`${label} ${result.value.status} ok=${result.value.ok} body=${JSON.stringify(result.value.bodyJson)}`,
				);
				continue;
			}

			const error = result.reason;
			const code = error && typeof error === "object" && "code" in error
				? String(error.code)
				: "unknown";
			const message = error instanceof Error ? error.message : String(error);
			HB.print("error", `${label} failed (${code}): ${message}`);
		}

		HB.print("info", "postJson smoke test complete");
	})().catch((error) => {
		const code = error && typeof error === "object" && "code" in error
			? String(error.code)
			: "unknown";
		const message = error instanceof Error ? error.message : String(error);
		HB.print("error", `postJson smoke test failed (${code}): ${message}`);
	});
});
