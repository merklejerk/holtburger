/** Borders moved by a pointer gesture; the owning surface applies its sizing rules. */
export type ResizeEdges =
	| {
			/** Horizontal border moved by this gesture. */
			readonly horizontal: "left" | "right";
			/** Vertical border, when resizing a corner. */
			readonly vertical?: "top" | "bottom";
	  }
	| {
			/** A top/bottom edge leaves width unchanged. */
			readonly horizontal?: never;
			/** Vertical border moved by a gesture along a horizontal edge. */
			readonly vertical: "top" | "bottom";
	  };
