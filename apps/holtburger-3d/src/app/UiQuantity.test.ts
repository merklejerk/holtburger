import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import UiQuantity from "./UiQuantity.svelte";

describe("quantity presentation", () => {
	it("pairs compact text with exact hover and accessible text", () => {
		const { body } = render(UiQuantity, { props: { value: 1_040_000n } });
		expect(body).toContain('title="1,040,000"');
		expect(body).toContain('<span aria-hidden="true">1.04M</span>');
		expect(body).toContain('<span class="sr-only">1,040,000</span>');
	});
});
