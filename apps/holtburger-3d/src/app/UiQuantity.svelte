<script lang="ts">
	import { formatCompactQuantity, formatQuantity } from "./quantity-format";

	interface Props {
		/** Exact quantity; millions abbreviate visually while hover and assistive text remain exact. */
		readonly value: number | bigint;
	}

	const { value }: Props = $props();
	const exact = $derived(formatQuantity(value));
</script>

<span title={exact}>
	<span aria-hidden="true">{formatCompactQuantity(value)}</span>
	<span class="sr-only">{exact}</span>
</span>
