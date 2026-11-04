<script lang="ts">
	import ClientInlineTag from "./ClientInlineTag.svelte";

	interface Props {
		/** Captured identity; names are display text and never lookup keys. */
		readonly guid: number;
		/** Historical name remains readable when selection is unavailable. */
		readonly text: string;
		/** Follow the containing chat buffer's explicit interaction mode. */
		readonly interactive: boolean;
		/** The caller owns lifetime admission, selection, and refusal feedback. */
		readonly onSelectEntity: (guid: number) => void;
	}
	const { guid, text, interactive, onSelectEntity }: Props = $props();
</script>

<ClientInlineTag
	class="entity-chat-tag"
	{text}
	{interactive}
	label={`Select entity: ${text}`}
	onActivate={() => onSelectEntity(guid)}
/>
