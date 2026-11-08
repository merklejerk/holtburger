/** Published paint texture shared by the masthead and editorial section bands. */
export const paintWashUrl =
	'https://merklejerk.github.io/holtburger-media/illustrations/ochre-wash-v1.webp';

/** Published concept art; kind controls guide alignment and dimensions reserve layout space. */
export const illustrations = {
	/** Reference-based hand-drawn study of Holtburg. */
	holtburg: {
		kind: 'landscape',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/holtburg-sepia-v2.webp',
		width: 1200,
		height: 614
	},
	/** Reference-based hand-drawn study of Q’alabar. */
	qalabar: {
		kind: 'landscape',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/qalabar-sepia-v2.webp',
		width: 1200,
		height: 614
	},
	/** Reference-based hand-drawn study of the Black Hills. */
	'black-hills': {
		kind: 'landscape',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/black-hills-sepia-v2.webp',
		width: 1200,
		height: 600
	},
	/** Reference-based hand-drawn study of Danby’s Outpost. */
	'danbys-outpost': {
		kind: 'landscape',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/danbys-outpost-sepia-v2.webp',
		width: 1200,
		height: 614
	},
	/** Reference-based hand-drawn study of a Lugian. */
	lugian: {
		kind: 'creature',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/lugian-sepia-v2.webp',
		width: 600,
		height: 840
	},
	/** Reference-based hand-drawn study of an Olthoi. */
	olthoi: {
		kind: 'creature',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/olthoi-sepia-v2.webp',
		width: 600,
		height: 800
	},
	/** Reference-based hand-drawn study of a Drudge. */
	drudge: {
		kind: 'creature',
		src: 'https://merklejerk.github.io/holtburger-media/illustrations/drudge-sepia-v2.webp',
		width: 600,
		height: 800
	}
} as const;

/** Renderable concept-art subjects, excluding the separate paint texture. */
export type IllustrationName = keyof typeof illustrations;
