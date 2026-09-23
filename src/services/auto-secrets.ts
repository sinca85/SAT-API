import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer | null {
  const value = process.env.GALENO_SETTINGS_ENCRYPTION_KEY ?? "";
  return /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : null;
}
export function canStoreAutoSecrets() { return encryptionKey() !== null; }
export function encryptAutoSecret(value: string) {
  const key = encryptionKey();
  if (!key) throw new Error("Galeno settings encryption is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptAutoSecret(value: string) {
  const key = encryptionKey();
  const [version, iv, tag, ciphertext] = value.split(":");
  if (!key || version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Galeno secret unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
