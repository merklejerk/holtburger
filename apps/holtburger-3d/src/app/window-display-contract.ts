import { z } from "zod";

/** Window content dimensions in logical desktop pixels, excluding native decorations. */
const windowContentSizeSchema = z
	.object({
		width: z.number().int().positive().safe(),
		height: z.number().int().positive().safe(),
	})
	.strict()
	.readonly();
export type WindowContentSize = z.infer<typeof windowContentSizeSchema>;

/** Native-owned decisions distinguish an acceptable preview from restoration-only recovery. */
const displayConfirmationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("preview"),
			/** Monotonic identity within this window owner. */
			id: z.number().int().positive().safe(),
			/** Wall-clock deadline in milliseconds, shared with the visible countdown. */
			expiresAt: z.number().int().positive().safe(),
		})
		.strict()
		.readonly(),
	z
		.object({
			kind: z.literal("recovery"),
			/** Retain the preview identity so pending answers can only retry restoration. */
			id: z.number().int().positive().safe(),
		})
		.strict()
		.readonly(),
]);

/** Native-owner projection consumed by display controls; presets respect the app minimum. */
export const windowDisplaySnapshotSchema = z
	.object({
		/** Confirmed native fullscreen state. */
		fullscreen: z.boolean(),
		/** Saved policy governing edge resizing and maximizing. */
		freeResize: z.boolean(),
		/** Disable controls until the current native transition finishes. */
		busy: z.boolean(),
		/** Preview decision or failed restoration awaiting retry; null during native operations. */
		confirmation: displayConfirmationSchema.nullable(),
		/** Current display refresh when GPU vsync is requested; null when disabled or unavailable. */
		vsyncRefreshHz: z.number().positive().nullable(),
		/** Actual viewport size, including any desktop scaling quantization. */
		contentSize: windowContentSizeSchema,
		/** Supported window sizes meeting the app minimum, independent of monitor placement. */
		presets: z.array(windowContentSizeSchema).readonly(),
	})
	.strict()
	.readonly();
export type WindowDisplaySnapshot = z.infer<typeof windowDisplaySnapshotSchema>;

/** Native window changes and preview decisions, independent of renderer quality. */
export const windowDisplayRequestSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("fullscreen"), enabled: z.boolean() }).strict(),
	z.object({ kind: z.literal("free-resize"), enabled: z.boolean() }).strict(),
	z.object({ kind: z.literal("size"), size: windowContentSizeSchema }).strict(),
	z
		.object({
			kind: z.literal("confirm"),
			/** Answer only the preview with this native-owned identity. */
			id: z.number().int().positive().safe(),
			/** Accept before its deadline, or restore the previously accepted settings. */
			keep: z.boolean(),
		})
		.strict(),
]);
export type WindowDisplayRequest = z.infer<typeof windowDisplayRequestSchema>;

/** Deliberate viewport presets; current custom sizes remain visible without becoming presets. */
export const WINDOW_CONTENT_PRESETS: readonly WindowContentSize[] = [
	{ width: 1024, height: 768 },
	{ width: 1152, height: 864 },
	{ width: 1280, height: 800 },
	{ width: 1280, height: 960 },
	{ width: 1280, height: 1024 },
	{ width: 1366, height: 768 },
	{ width: 1440, height: 900 },
	{ width: 1600, height: 900 },
	{ width: 1600, height: 1200 },
	{ width: 1920, height: 1080 },
	{ width: 1920, height: 1200 },
	{ width: 2560, height: 1440 },
	{ width: 2560, height: 1600 },
	{ width: 3440, height: 1440 },
	{ width: 3840, height: 2160 },
];
