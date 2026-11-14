<script lang="ts">
	import ClientLockFeedback from "../../client/ClientLockFeedback.svelte";
	import type { ClientLockFeedbackFrame } from "../../client/client-lock-feedback";

	let {
		readFrames,
		isActive,
	}: {
		readonly readFrames: () => readonly ClientLockFeedbackFrame[];
		readonly isActive: () => boolean;
	} = $props();
	let wakeRevision = $state(0);

	export function wake(): void {
		wakeRevision += 1;
	}
</script>

<ClientLockFeedback {readFrames} {isActive} {wakeRevision} />
