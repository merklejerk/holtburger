<script lang="ts">
	import {
		DEFAULT_COLOR_GRADE_PARAMETERS,
		MAXIMUM_SATURATION,
		createColorGradeParameters,
		createMonotoneSpline,
		evaluateMonotoneSpline,
		type ColorGradeCurve,
		type ColorGradeParameters,
		type ColorGradeSettings,
	} from "../lib/game/renderer/color-grade-policy";
	import {
		COLOR_GRADE_CURVE_CHANNELS,
		addControlPoint,
		findControlPointAt,
		moveControlPoint,
		removeControlPoint,
		serializeColorGradeTuningFragment,
		withCurve,
		type ColorGradeCurveChannel,
	} from "./explorer-color-grade";

	interface Props {
		readonly colorGrade: ColorGradeSettings;
		readonly updateColorGradeSettings: (settings: ColorGradeSettings) => void;
	}

	const { colorGrade, updateColorGradeSettings }: Props = $props();

	/** Editor viewBox size. Larger than a unit box so stroke widths stay readable numbers. */
	const EDITOR_SIZE = 200;
	/**
	 * Margin around the curve field, in the same units.
	 *
	 * The first and last control points sit exactly on the field's edge, and dragging them is how
	 * an author lifts blacks or clips whites. Without a margin their handles are drawn half
	 * outside the viewBox, which reads as though they are not there to grab.
	 */
	const EDITOR_PADDING = 8;
	const EDITOR_EXTENT = EDITOR_SIZE + EDITOR_PADDING * 2;
	/** Samples used to draw the curve. Dense enough that the spline reads as a curve. */
	const CURVE_SAMPLE_COUNT = 64;
	/** Grab radius for hit-testing, in normalized curve units. */
	const GRAB_RADIUS = 0.05;

	let channel = $state<ColorGradeCurveChannel>("master");
	let draggingIndex = $state<number | null>(null);
	let copyStatus = $state<string | null>(null);

	const parameters = $derived(colorGrade.parameters);
	const activeCurve = $derived(parameters.curves[channel]);
	const curvePath = $derived(buildCurvePath(activeCurve));

	/** Sample the same spline the renderer bakes, so the drawing cannot disagree with the look. */
	function buildCurvePath(curve: ColorGradeCurve): string {
		const spline = createMonotoneSpline(curve);
		const segments: string[] = [];
		for (let step = 0; step <= CURVE_SAMPLE_COUNT; step += 1) {
			const x = step / CURVE_SAMPLE_COUNT;
			const y = evaluateMonotoneSpline(spline, x);
			segments.push(
				`${step === 0 ? "M" : "L"} ${(x * EDITOR_SIZE).toFixed(2)} ${(
					(1 - y) *
					EDITOR_SIZE
				).toFixed(2)}`,
			);
		}
		return segments.join(" ");
	}

	function publish(next: ColorGradeParameters): void {
		updateColorGradeSettings({
			enabled: colorGrade.enabled,
			parameters: createColorGradeParameters(next),
		});
	}

	function publishCurve(curve: ColorGradeCurve): void {
		publish({
			...parameters,
			curves: withCurve(parameters.curves, channel, curve),
		});
	}

	/**
	 * Convert a pointer event into curve space, with y measured from the bottom.
	 *
	 * The element's box spans the padded viewBox, so the margin has to come back out before the
	 * result is a curve coordinate.
	 */
	function curvePoint(event: PointerEvent | MouseEvent): {
		x: number;
		y: number;
	} {
		const bounds = (
			event.currentTarget as SVGSVGElement
		).getBoundingClientRect();
		const viewX =
			((event.clientX - bounds.left) / bounds.width) * EDITOR_EXTENT -
			EDITOR_PADDING;
		const viewY =
			((event.clientY - bounds.top) / bounds.height) * EDITOR_EXTENT -
			EDITOR_PADDING;
		return { x: viewX / EDITOR_SIZE, y: 1 - viewY / EDITOR_SIZE };
	}

	function handlePointerDown(event: PointerEvent): void {
		const point = curvePoint(event);
		const existing = findControlPointAt(
			activeCurve,
			point.x,
			point.y,
			GRAB_RADIUS,
		);
		if (existing !== null) {
			draggingIndex = existing;
		} else {
			const grown = addControlPoint(activeCurve, point.x, point.y);
			if (grown === activeCurve) return;
			publishCurve(grown);
			draggingIndex = findControlPointAt(grown, point.x, point.y, GRAB_RADIUS);
		}
		(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (draggingIndex === null) return;
		const point = curvePoint(event);
		publishCurve(
			moveControlPoint(activeCurve, draggingIndex, point.x, point.y),
		);
	}

	function handlePointerUp(event: PointerEvent): void {
		draggingIndex = null;
		(event.currentTarget as SVGSVGElement).releasePointerCapture(
			event.pointerId,
		);
	}

	function handleDoubleClick(event: MouseEvent): void {
		const point = curvePoint(event);
		const existing = findControlPointAt(
			activeCurve,
			point.x,
			point.y,
			GRAB_RADIUS,
		);
		if (existing === null) return;
		publishCurve(removeControlPoint(activeCurve, existing));
	}

	function updateScalar(
		field: "temperature" | "tint" | "saturation",
		event: Event,
	): void {
		publish({
			...parameters,
			[field]: Number((event.currentTarget as HTMLInputElement).value),
		});
	}

	async function copyTuning(): Promise<void> {
		const fragment = serializeColorGradeTuningFragment(
			parameters,
			colorGrade.enabled,
		);
		try {
			await navigator.clipboard.writeText(fragment);
			copyStatus =
				"Copied. Paste over the colorGrade block in frontend-tuning.ts.";
		} catch (cause) {
			// Surfaced rather than swallowed: a silent no-op reads as a successful copy, and the
			// author only finds out when they paste the previous clipboard into their source.
			copyStatus = `Clipboard write failed: ${cause instanceof Error ? cause.message : String(cause)}`;
		}
	}
</script>

<div class="explorer-grading-panel">
	<label class="explorer-toggle">
		<input
			checked={colorGrade.enabled}
			type="checkbox"
			onchange={(event) =>
				updateColorGradeSettings({
					...colorGrade,
					enabled: (event.currentTarget as HTMLInputElement).checked,
				})}
		/>
		<span>Color grade</span>
		<strong>{colorGrade.enabled ? "On" : "Off"}</strong>
	</label>
	<p>
		A deliberate departure from retail, which presents its output ungraded. Off
		is bit-exact retail-faithful presentation.
	</p>

	<fieldset class="explorer-section" disabled={!colorGrade.enabled}>
		<label class="explorer-environment-field">
			<span>Temperature ({parameters.temperature.toFixed(2)})</span>
			<input
				max="1"
				min="-1"
				step="0.01"
				type="range"
				value={parameters.temperature}
				oninput={(event) => updateScalar("temperature", event)}
			/>
		</label>
		<label class="explorer-environment-field">
			<span>Tint ({parameters.tint.toFixed(2)})</span>
			<input
				max="1"
				min="-1"
				step="0.01"
				type="range"
				value={parameters.tint}
				oninput={(event) => updateScalar("tint", event)}
			/>
		</label>
		<label class="explorer-environment-field">
			<span>Saturation ({parameters.saturation.toFixed(2)})</span>
			<input
				max={MAXIMUM_SATURATION}
				min="0"
				step="0.01"
				type="range"
				value={parameters.saturation}
				oninput={(event) => updateScalar("saturation", event)}
			/>
		</label>

		<p class="ac-section-label">Curves</p>
		<div
			class="explorer-grade-channels"
			role="tablist"
			aria-label="Curve channel"
		>
			{#each COLOR_GRADE_CURVE_CHANNELS as option}
				<button
					type="button"
					class="explorer-grade-channel"
					class:active={option === channel}
					role="tab"
					aria-selected={option === channel}
					onclick={() => (channel = option)}
				>
					{option}
				</button>
			{/each}
		</div>

		<svg
			class="explorer-grade-curve"
			class:disabled={!colorGrade.enabled}
			viewBox={`${-EDITOR_PADDING} ${-EDITOR_PADDING} ${EDITOR_EXTENT} ${EDITOR_EXTENT}`}
			role="application"
			aria-label={`${channel} curve editor`}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			ondblclick={handleDoubleClick}
		>
			<rect
				x="0"
				y="0"
				width={EDITOR_SIZE}
				height={EDITOR_SIZE}
				class="grade-field"
			/>
			<line
				x1="0"
				y1={EDITOR_SIZE}
				x2={EDITOR_SIZE}
				y2="0"
				class="grade-identity"
			/>
			<path d={curvePath} class="grade-curve" />
			{#each activeCurve as point, index}
				<circle
					cx={point.x * EDITOR_SIZE}
					cy={(1 - point.y) * EDITOR_SIZE}
					r="4"
					class="grade-point"
					class:dragging={index === draggingIndex}
				/>
			{/each}
		</svg>
		<p>
			Click to add a point, drag to shape, double-click to remove. The first and
			last points keep their positions on the input axis so every source level
			stays defined.
		</p>

		<div class="explorer-grade-actions">
			<button
				type="button"
				class="explorer-action"
				onclick={() => {
					copyStatus = null;
					publish(DEFAULT_COLOR_GRADE_PARAMETERS);
				}}
			>
				Reset
			</button>
			<button type="button" class="explorer-action" onclick={copyTuning}>
				Copy tuning
			</button>
		</div>
		{#if copyStatus}
			<p>{copyStatus}</p>
		{/if}
	</fieldset>
</div>

<style>
	.explorer-grade-channels {
		display: flex;
		gap: 0.25rem;
	}

	.explorer-grade-channel {
		flex: 1;
		text-transform: capitalize;
		cursor: pointer;
	}

	.explorer-grade-channel.active {
		font-weight: 700;
		text-decoration: underline;
	}

	.explorer-grade-curve {
		width: 100%;
		aspect-ratio: 1;
		touch-action: none;
		cursor: crosshair;
	}

	/* An SVG is not a form control, so the surrounding disabled fieldset does not reach it. */
	.explorer-grade-curve.disabled {
		pointer-events: none;
		opacity: 0.45;
	}

	.grade-field {
		fill: rgb(0 0 0 / 0.25);
		stroke: currentColor;
		stroke-width: 1;
	}

	.grade-identity {
		stroke: currentColor;
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.4;
	}

	.grade-curve {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
	}

	.grade-point {
		fill: currentColor;
	}

	.grade-point.dragging {
		r: 6;
	}

	.explorer-grade-actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
