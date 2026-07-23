const ENTRY_PATHS = {
	explorer: {
		path: "explorer/index.html",
		title: "Holtburger 3D Explorer",
	},
	client: {
		path: "client/index.html",
		title: "Holtburger 3D Client",
	},
};

function isKnownEntry(value) {
	return Object.hasOwn(ENTRY_PATHS, value);
}

export function buildEntryPath(basePath, args) {
	const params = new URLSearchParams();

	for (const arg of args) {
		if (arg.startsWith("--query=")) {
			appendQuery(params, arg.slice("--query=".length));
			continue;
		}

		if (!arg.startsWith("--")) {
			throw new Error(
				`Unsupported positional argument "${arg}". Use --name=value.`,
			);
		}

		const withoutPrefix = arg.slice(2);
		const separatorIndex = withoutPrefix.indexOf("=");
		const key =
			separatorIndex === -1
				? withoutPrefix
				: withoutPrefix.slice(0, separatorIndex);
		const value =
			separatorIndex === -1 ? "true" : withoutPrefix.slice(separatorIndex + 1);

		if (key.length === 0) {
			throw new Error(`Invalid empty parameter in "${arg}".`);
		}

		params.append(key, value);
	}

	const query = params.toString();
	return query.length === 0 ? basePath : `${basePath}?${query}`;
}

export function requireEntry(value) {
	if (isKnownEntry(value)) {
		return ENTRY_PATHS[value];
	}

	const knownEntries = Object.keys(ENTRY_PATHS).join(", ");
	throw new Error(
		`Unknown dev entry "${value ?? ""}". Expected one of: ${knownEntries}.`,
	);
}

function appendQuery(params, query) {
	const queryParams = new URLSearchParams(
		query.startsWith("?") ? query.slice(1) : query,
	);

	for (const [key, value] of queryParams.entries()) {
		params.append(key, value);
	}
}
