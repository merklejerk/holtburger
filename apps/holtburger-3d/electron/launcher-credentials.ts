import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import {
	launcherCredentialsSchema,
	type EncryptedCredentials,
	type LauncherCredentials,
} from "../src/launcher/launcher-contract.js";

// Stable across installations/releases by design: discourages casual plaintext scraping only.
const CREDENTIAL_SEED = "holtburger-launcher-credentials-v1:portal-to-dereth";
const KEY = createHash("sha256").update(CREDENTIAL_SEED).digest();
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Each encryption gets its own nonce; credential-owner identity authenticates the envelope's owner. */
export function encryptCredentials(
	ownerId: string,
	credentials: LauncherCredentials,
): EncryptedCredentials {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", KEY, nonce, {
		authTagLength: TAG_BYTES,
	});
	cipher.setAAD(Buffer.from(ownerId));
	const ciphertext = Buffer.concat([
		cipher.update(
			JSON.stringify(launcherCredentialsSchema.parse(credentials)),
			"utf8",
		),
		cipher.final(),
	]);
	return {
		version: 1,
		nonce: nonce.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
		authenticationTag: cipher.getAuthTag().toString("base64"),
	};
}
/** Authentication/decode errors are surfaced by the credential owner, never replaced with empty secrets. */
export function decryptCredentials(
	ownerId: string,
	envelope: EncryptedCredentials,
): LauncherCredentials {
	if (envelope.version !== 1)
		throw new Error("Saved credential version is unsupported");
	const nonce = Buffer.from(envelope.nonce, "base64");
	const tag = Buffer.from(envelope.authenticationTag, "base64");
	if (nonce.length !== NONCE_BYTES)
		throw new Error("Saved credential nonce has an invalid length");
	if (tag.length !== TAG_BYTES)
		throw new Error(
			"Saved credential authentication tag has an invalid length",
		);
	const cipher = createDecipheriv("aes-256-gcm", KEY, nonce, {
		authTagLength: TAG_BYTES,
	});
	cipher.setAAD(Buffer.from(ownerId));
	cipher.setAuthTag(tag);
	const plaintext = Buffer.concat([
		cipher.update(Buffer.from(envelope.ciphertext, "base64")),
		cipher.final(),
	]);
	return launcherCredentialsSchema.parse(
		JSON.parse(plaintext.toString("utf8")),
	);
}
