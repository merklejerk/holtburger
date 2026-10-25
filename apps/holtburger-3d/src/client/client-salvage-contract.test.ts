import { expect, it } from "vitest";
import fixture from "./fixtures/salvage-wire.json";
import {
	salvageCandidateSchema,
	salvageContextSchema,
	salvagePreviewResultSchema,
	salvageSubmitRequestSchema,
	salvageSubmitResultSchema,
} from "./client-salvage-contract";

it("accepts the exact world/core wire fixture verified by the Rust host", () => {
	expect(salvageCandidateSchema.parse(fixture.candidate)).toEqual(
		fixture.candidate,
	);
	expect(salvageContextSchema.parse(fixture.context)).toEqual(fixture.context);
	expect(salvagePreviewResultSchema.parse(fixture.preview)).toEqual(
		fixture.preview,
	);
	expect(salvageSubmitRequestSchema.parse(fixture.submit)).toEqual(
		fixture.submit,
	);
	expect(salvageSubmitResultSchema.parse(fixture.result)).toEqual(
		fixture.result,
	);
});
