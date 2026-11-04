<script lang="ts">
	import MoveIcon from "../assets/icons/layout-move.svg?component";
	import ShapeIcon from "../assets/icons/layout-shape.svg?component";
	import RotateIcon from "../assets/icons/layout-rotate.svg?component";
	import ResizeIcon from "../assets/icons/layout-resize.svg?component";
	/** Layout operation represented by this decorative icon; the button owns its label. */
	let { action }: { action: "move" | "resize" | "shape" | "rotate" } = $props();
	const icons = {
		move: MoveIcon,
		shape: ShapeIcon,
		rotate: RotateIcon,
		resize: ResizeIcon,
	};
	const Icon = $derived(icons[action]);
</script>

<Icon />
