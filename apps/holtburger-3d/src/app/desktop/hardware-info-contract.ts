import { z } from "zod";

/** Only frontend build identity and an explicitly requested launcher probe cross into the host. */
export const hardwareInfoRequestSchema = z
	.object({
		/** Displayed build label includes revision and modified/development state. */
		build: z.string().max(256),
		/** Null means the launcher could not create a WebGL2 context. */
		webgl: z
			.record(
				z.enum([
					"renderer",
					"vendor",
					"version",
					"shadingLanguageVersion",
					"unmaskedRenderer",
					"unmaskedVendor",
				]),
				z.string().max(4096).nullable(),
			)
			.nullable(),
	})
	.strict();
export type HardwareInfoRequest = z.infer<typeof hardwareInfoRequestSchema>;
