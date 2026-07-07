export interface CadencedDirtySamplerOptions {
	intervalMs: number;
	sample: () => void;
	initiallyDirty?: boolean;
	setIntervalFn?: typeof setInterval;
	clearIntervalFn?: typeof clearInterval;
}

export interface CadencedDirtySampler {
	readonly dirty: boolean;
	start(): void;
	markDirty(): void;
	sampleNow(): void;
	dispose(): void;
}

export function createCadencedDirtySampler({
	intervalMs,
	sample,
	initiallyDirty = true,
	setIntervalFn = setInterval,
	clearIntervalFn = clearInterval,
}: CadencedDirtySamplerOptions): CadencedDirtySampler {
	let dirty = initiallyDirty;
	let timer: ReturnType<typeof setInterval> | null = null;

	function sampleIfDirty(): void {
		if (!dirty) {
			return;
		}
		dirty = false;
		sample();
	}

	return {
		get dirty() {
			return dirty;
		},
		start() {
			if (timer !== null) {
				return;
			}
			timer = setIntervalFn(sampleIfDirty, intervalMs);
		},
		markDirty() {
			dirty = true;
		},
		sampleNow() {
			dirty = false;
			sample();
		},
		dispose() {
			if (timer === null) {
				return;
			}
			clearIntervalFn(timer);
			timer = null;
		},
	};
}
