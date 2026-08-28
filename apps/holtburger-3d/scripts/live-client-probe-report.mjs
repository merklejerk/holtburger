const MAX_HOST_DIAGNOSTIC_CHARACTERS = 4_096;

/** @typedef {{ account: string; password: string }} ProbeCredentials */

/**
 * @typedef {object} ProbeFailureContext
 * @property {ProbeCredentials} credentials
 * @property {string} lastCompletedPhase
 * @property {readonly unknown[]} lifecycle
 * @property {readonly unknown[]} terminalEvents
 * @property {string} stderr
 */

/**
 * Redacts the launch credentials from one diagnostic string.
 *
 * @param {unknown} value
 * @param {ProbeCredentials} credentials
 */
export function redactProbeText(value, credentials) {
	const text = String(value);
	const withoutPassword =
		credentials.password.length > 0
			? text.replaceAll(credentials.password, "<password>")
			: text;
	return credentials.account.length > 0
		? withoutPassword.replaceAll(credentials.account, "<account>")
		: withoutPassword;
}

/**
 * Serializes probe evidence while redacting string values without mutating report field names.
 *
 * @param {unknown} value
 * @param {ProbeCredentials} credentials
 */
export function stringifyRedactedProbeReport(value, credentials) {
	return JSON.stringify(value, (_key, member) =>
		typeof member === "string" ? redactProbeText(member, credentials) : member,
	);
}

/**
 * Converts an arbitrary thrown value into the probe's bounded error contract.
 *
 * @param {unknown} error
 * @param {ProbeCredentials} credentials
 */
export function probeError(error, credentials) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		...(error instanceof Error ? { name: error.name } : {}),
		message: redactProbeText(message, credentials),
	};
}

/**
 * Returns a credential-redacted tail of host stderr, or null when the host was silent.
 *
 * @param {unknown} stderr
 * @param {ProbeCredentials} credentials
 */
export function probeHostDiagnostic(stderr, credentials) {
	const redacted = redactProbeText(stderr, credentials).trim();
	if (redacted.length === 0) return null;
	if (redacted.length <= MAX_HOST_DIAGNOSTIC_CHARACTERS) return redacted;
	return `…${redacted.slice(-MAX_HOST_DIAGNOSTIC_CHARACTERS)}`;
}

/**
 * Builds the machine-readable failure result retained after probe cleanup.
 *
 * @param {unknown} error
 * @param {ProbeFailureContext} context
 */
export function createProbeFailureResult(error, context) {
	return {
		ok: false,
		error: probeError(error, context.credentials),
		lastCompletedPhase: context.lastCompletedPhase,
		lifecycle: context.lifecycle,
		terminalEvents: context.terminalEvents,
		hostDiagnostic: probeHostDiagnostic(context.stderr, context.credentials),
	};
}
