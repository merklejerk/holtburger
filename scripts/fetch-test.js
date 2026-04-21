HB.onEvent((event) => {
	if (event.kind !== "lifecycle" || event.data.kind !== "started") {
		return;
	}

	(async () => {
		HB.print("info", "starting fetchJson smoke test");

		const [getResult, postResult] = await Promise.allSettled([
			HB.fetchJson({
				url: "https://httpbin.org/get?source=holtburger",
			}),
			HB.fetchJson({
				url: "https://httpbin.org/post",
				method: "POST",
				bodyJson: {
					kind: "fetchJson-smoke-test",
					source: "holtburger",
					values: [1, 2, 3],
				},
			}),
		]);

		for (const [label, result] of [
			["GET", getResult],
			["POST", postResult],
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

		HB.print("info", "fetchJson smoke test complete");
	})().catch((error) => {
		const code = error && typeof error === "object" && "code" in error
			? String(error.code)
			: "unknown";
		const message = error instanceof Error ? error.message : String(error);
		HB.print("error", `fetchJson smoke test failed (${code}): ${message}`);
	});
});
