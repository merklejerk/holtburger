<script lang="ts">
  let {
    modeLabel,
    status,
    detail,
  }: {
    modeLabel: string;
    status: string;
    detail: string;
  } = $props();
</script>

<div class="world-display">
  <div class="world-display__header">
    <p class="world-display__eyebrow">WorldDisplay</p>
    <span>{modeLabel}</span>
  </div>
  <div class="world-display__viewport">
    <div class="world-display__reticle"></div>
    <p>{status}</p>
  </div>
  <p class="world-display__detail">{detail}</p>
</div>