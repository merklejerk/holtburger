const LAUNCH_URL_ENV = "VITE_HOLTBURGER_LAUNCH_URL";
const QUERY_PARAMS_ENV = "VITE_HOLTBURGER_QUERY_PARAMS";

let cachedLaunchQueryParams: URLSearchParams | null = null;

export function readLaunchQueryParam(name: string): string | null {
	return readLaunchQueryParams().get(name);
}

function readLaunchQueryParams(): URLSearchParams {
	if (cachedLaunchQueryParams) {
		return cachedLaunchQueryParams;
	}
	cachedLaunchQueryParams = new URLSearchParams();
	if (typeof window !== "undefined") {
		mergeParams(
			cachedLaunchQueryParams,
			new URLSearchParams(window.location.search),
		);
	}
	mergeParams(
		cachedLaunchQueryParams,
		parseQueryParamsEnv(readViteEnv(QUERY_PARAMS_ENV)),
	);
	mergeParams(cachedLaunchQueryParams, parseLaunchUrlEnv(readViteEnv(LAUNCH_URL_ENV)));
	return cachedLaunchQueryParams;
}

function parseQueryParamsEnv(value: string | undefined): URLSearchParams {
	if (!value) {
		return new URLSearchParams();
	}
	return new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
}

function parseLaunchUrlEnv(value: string | undefined): URLSearchParams {
	if (!value) {
		return new URLSearchParams();
	}
	const url = new URL(value, "http://127.0.0.1");
	return new URLSearchParams(url.search);
}

function mergeParams(target: URLSearchParams, source: URLSearchParams): void {
	for (const [key, value] of source) {
		target.set(key, value);
	}
}

function readViteEnv(name: string): string | undefined {
	return import.meta.env[name] as string | undefined;
}
