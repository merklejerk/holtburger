import { describe, expect, it } from "vitest";
import { formatCompactQuantity, formatQuantity } from "./quantity-format";

describe("compact quantities", () => {
	it.each([
		[0n, "0"],
		[999_999n, "999,999"],
		[1_000_000n, "1M"],
		[1_040_000n, "1.04M"],
		[1_045_000n, "1.05M"],
		[1_200_000_000n, "1.2B"],
		[3_110_000_000n, "3.11B"],
		[999_999_999n, "1B"],
		[1_000_000_000_000n, "1T"],
		[-1_040_000n, "-1.04M"],
	])("formats %s as %s for bigint and number callers", (value, expected) => {
		expect(formatCompactQuantity(value)).toBe(expected);
		expect(formatCompactQuantity(Number(value))).toBe(expected);
	});

	it("preserves bigint rounding and full values beyond safe number precision", () => {
		// Converting this value to number crosses the compact rounding boundary.
		const value = 9_007_214_999_999_999n;
		expect(formatCompactQuantity(value)).toBe("9007.21T");
		expect(formatCompactQuantity(Number(value))).toBe("9007.22T");
		expect(formatQuantity(value)).toBe("9,007,214,999,999,999");
	});
});
