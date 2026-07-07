<script lang="ts">
	type CopyStatus = "copied" | "failed" | "ready";

	interface Props {
		readonly copyLabel?: string;
		readonly eyebrow: string;
		readonly text: string;
		readonly title: string;
		readonly titleId: string;
		readonly onClose: () => void;
	}

	let {
		copyLabel = "Copy",
		eyebrow,
		text,
		title,
		titleId,
		onClose,
	}: Props = $props();

	let copyStatus = $state<CopyStatus>("ready");

	$effect(() => {
		text;
		copyStatus = "ready";
	});

	async function copyText(): Promise<void> {
		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(text);
			} else {
				copyTextWithSelectionFallback(text);
			}
			copyStatus = "copied";
		} catch {
			copyStatus = "failed";
		}
	}

	function copyTextWithSelectionFallback(value: string): void {
		const textarea = document.createElement("textarea");
		textarea.value = value;
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		textarea.setAttribute("readonly", "");
		document.body.appendChild(textarea);
		textarea.select();
		const copied = document.execCommand("copy");
		textarea.remove();
		if (!copied) {
			throw new Error("Clipboard fallback copy failed.");
		}
	}
</script>

<div class="diagnostics-modal__backdrop" data-browser-display-modal>
	<div
		class="diagnostics-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
	>
		<div class="diagnostics-modal__header">
			<div>
				<p>{eyebrow}</p>
				<h2 id={titleId}>{title}</h2>
			</div>
			<button type="button" onclick={onClose}>Close</button>
		</div>
		<textarea readonly spellcheck="false" value={text}></textarea>
		<div class="diagnostics-modal__actions">
			<span>
				{copyStatus === "copied"
					? "Copied."
					: copyStatus === "failed"
						? "Copy failed."
						: "Ready to copy."}
			</span>
			<button type="button" onclick={() => void copyText()}>{copyLabel}</button>
		</div>
	</div>
</div>

<style>
	.diagnostics-modal__backdrop {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.46);
		pointer-events: auto;
	}

	.diagnostics-modal {
		display: grid;
		grid-template-rows: auto minmax(240px, 1fr) auto;
		gap: 10px;
		width: min(920px, calc(100vw - 32px));
		height: min(680px, calc(100vh - 32px));
		box-sizing: border-box;
		padding: 12px;
		border: 1px solid rgba(91, 255, 187, 0.52);
		border-radius: 6px;
		background:
			linear-gradient(180deg, rgba(9, 27, 23, 0.98), rgba(4, 12, 11, 0.97)),
			rgba(4, 12, 11, 0.97);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.8),
			0 24px 70px rgba(0, 0, 0, 0.58),
			0 0 42px rgba(57, 255, 170, 0.13);
		color: #d9ffe8;
	}

	.diagnostics-modal__header,
	.diagnostics-modal__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}

	.diagnostics-modal__header p {
		margin: 0 0 2px;
		color: #75ffd1;
		font-size: 10px;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.diagnostics-modal__header h2 {
		margin: 0;
		color: #f1fff6;
		font-size: 16px;
		line-height: 1.2;
		letter-spacing: 0;
	}

	.diagnostics-modal textarea {
		width: 100%;
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		resize: none;
		padding: 10px;
		border: 1px solid rgba(91, 255, 187, 0.25);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.88);
		color: #f1fff6;
		font:
			11px/1.45 "IBM Plex Mono",
			"SFMono-Regular",
			Consolas,
			"Liberation Mono",
			monospace;
		outline: none;
		white-space: pre;
	}

	.diagnostics-modal__actions span {
		min-width: 0;
		color: #fff7cf;
		font-size: 12px;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid rgba(91, 255, 187, 0.45);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.92);
		color: #d9ffe8;
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		line-height: 1;
		text-align: center;
		white-space: nowrap;
	}

	button:hover {
		border-color: rgba(255, 214, 102, 0.9);
		color: #fff7cf;
		box-shadow: inset 0 0 18px rgba(255, 214, 102, 0.11);
	}

	@media (max-width: 720px) {
		.diagnostics-modal__backdrop {
			padding: 10px;
		}

		.diagnostics-modal {
			width: calc(100vw - 20px);
			height: calc(100vh - 20px);
		}
	}
</style>
