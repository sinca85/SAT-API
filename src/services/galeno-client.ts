import { createHash, randomUUID } from "node:crypto";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import { GalenoSession } from "../models/galeno-session.js";
import { canStoreAutoSecrets, decryptAutoSecret, encryptAutoSecret } from "./auto-secrets.js";
import { GALENO_SANDBOX_URL, type AutoConfiguration } from "./auto-settings.js";
import { sandboxBasicAuthorization } from "./galeno-sandbox.js";

export class GalenoError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
export type TokenStore = {
  get(key: string, fingerprint: string): Promise<string | null>;
  acquire(key: string, owner: string): Promise<boolean>;
  save(key: string, owner: string, fingerprint: string, token: string, seconds: number): Promise<void>;
  release(key: string, owner: string): Promise<void>;
  invalidate(key: string, token: string): Promise<void>;
};
const databaseTokens: TokenStore = {
  async get(key, fingerprint) {
    const entry = await GalenoSession.findOne({ key, fingerprint, expiresAt: { $gt: new Date(Date.now() + 60000) } }).select("+tokenEncrypted").lean();
    if (!entry?.tokenEncrypted) return null;
    try { return decryptAutoSecret(entry.tokenEncrypted); } catch { return null; }
  },
  async acquire(key, owner) {
    try { await GalenoSession.updateOne({ key }, { $setOnInsert: { key, lockUntil: new Date(0) } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    return Boolean(await GalenoSession.findOneAndUpdate({ key, $or: [{ lockUntil: { $lt: new Date() } }, { lockUntil: null }] }, { $set: { lockUntil: new Date(Date.now() + 25000), lockOwner: owner } }));
  },
  async save(key, owner, fingerprint, token, seconds) {
    await GalenoSession.updateOne({ key, lockOwner: owner }, { $set: { fingerprint, tokenEncrypted: encryptAutoSecret(token), expiresAt: new Date(Date.now() + seconds * 1000), lockUntil: new Date(0), lockOwner: "" } });
  },
  async release(key, owner) { await GalenoSession.updateOne({ key, lockOwner: owner }, { $set: { lockUntil: new Date(0), lockOwner: "" } }); },
  async invalidate(key, token) {
    const entry = await GalenoSession.findOne({ key }).select("+tokenEncrypted").lean();
    if (!entry?.tokenEncrypted) return;
    // Compare ciphertext in the update so a newer session is never invalidated by an old 401.
    if (decryptAutoSecret(entry.tokenEncrypted) === token) await GalenoSession.updateOne({ key, tokenEncrypted: entry.tokenEncrypted }, { $set: { expiresAt: new Date(0) } });
  },
};
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type ProxyRequestInit = RequestInit & { dispatcher?: Dispatcher };
export type GalenoTransport = (url: string, init: RequestInit) => Promise<Response>;

let proxyUrl = "";
let proxyAgent: ProxyAgent | undefined;

function fixieDispatcher(value: string): ProxyAgent {
  if (proxyAgent && proxyUrl === value) return proxyAgent;
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new GalenoError("proxy_configuration_invalid", "La conexión segura de Galeno no está configurada correctamente.", 503); }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new GalenoError("proxy_configuration_invalid", "La conexión segura de Galeno no está configurada correctamente.", 503);
  }
  proxyUrl = value;
  proxyAgent = new ProxyAgent(value);
  return proxyAgent;
}

export function createGalenoTransport(fixieUrl = process.env.FIXIE_URL, directFetch?: typeof fetch): GalenoTransport {
  if (!fixieUrl) return (url, init) => (directFetch ?? fetch)(url, init);
  const dispatcher = fixieDispatcher(fixieUrl);
  if (directFetch) return (url, init) => directFetch(url, { ...init, dispatcher } as ProxyRequestInit);
  return (url, init) => undiciFetch(url, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

function safeTransportError(error: unknown) {
  const cause = error instanceof Error && error.cause && typeof error.cause === "object"
    ? error.cause as { code?: unknown; name?: unknown }
    : undefined;
  return {
    proxyConfigured: Boolean(process.env.FIXIE_URL),
    errorName: error instanceof Error ? error.name : "UnknownError",
    causeName: typeof cause?.name === "string" ? cause.name : undefined,
    causeCode: typeof cause?.code === "string" ? cause.code : undefined,
  };
}

export function createGalenoClient(settings: AutoConfiguration, transport: GalenoTransport = createGalenoTransport(), tokens: TokenStore = databaseTokens) {
  // Only the documented sandbox is permitted. Never send credentials to a configurable host.
  if (settings.environment !== "test" || settings.baseUrl !== GALENO_SANDBOX_URL) throw new GalenoError("sandbox_only", "Esta integración está habilitada únicamente para el sandbox de Galeno.", 503);
  if (!settings.username || !settings.passwordEncrypted || !canStoreAutoSecrets()) throw new GalenoError("credentials_missing", "Falta configurar el usuario y la contraseña de Galeno.", 503);
  let password: string, basic: string;
  try {
    password = decryptAutoSecret(settings.passwordEncrypted);
    basic = settings.authorizationEncrypted ? decryptAutoSecret(settings.authorizationEncrypted) : sandboxBasicAuthorization;
  } catch { throw new GalenoError("credentials_unavailable", "No se pudieron recuperar las credenciales de Galeno. Revisá la clave de cifrado del servidor.", 503); }
  basic = basic.replace(/^Basic\s+/i, "");
  const key = hash(`${GALENO_SANDBOX_URL}:${settings.username}`);
  const fingerprint = hash(`${settings.username}:${password}:${basic}`);
  async function jsonRequest(path: string, init: RequestInit) {
    try {
      const response = await transport(`${GALENO_SANDBOX_URL}${path}`, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" });
      const data: unknown = await response.json().catch(() => null);
      return { response, data };
    } catch (error) {
      console.error("Galeno transport failed", safeTransportError(error));
      throw new GalenoError("unavailable", "No pudimos comunicarnos con Galeno. Intentá nuevamente en unos minutos.", 503);
    }
  }
  async function token() {
    const deadline = Date.now() + 28000;
    while (Date.now() < deadline) {
      const cached = await tokens.get(key, fingerprint);
      if (cached) return cached;
      const owner = randomUUID();
      if (!await tokens.acquire(key, owner)) { await sleep(150); continue; }
      try {
        const existing = await tokens.get(key, fingerprint);
        if (existing) return existing;
        const { response, data } = await jsonRequest("/seguridad/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", username: settings.username, password }).toString() });
        const result = data as { access_token?: unknown; expires_in?: unknown } | null;
        if (!response.ok || typeof result?.access_token !== "string") throw new GalenoError("authentication_failed", "Galeno no autorizó el acceso. Revisá usuario, contraseña, autorización del sandbox e IP habilitada.", 502);
        const seconds = Number(result.expires_in);
        await tokens.save(key, owner, fingerprint, result.access_token, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 300);
        return result.access_token;
      } finally { await tokens.release(key, owner); }
    }
    throw new GalenoError("session_busy", "La conexión con Galeno se está actualizando. Volvé a intentar.", 503);
  }
  return async function request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    if (!/^\/api\/(cotizadores\/(auto|comun)\/|administracion\/usuario\/planes\/comerciales)/.test(path) || path.includes("..")) throw new GalenoError("invalid_endpoint", "Servicio no habilitado.", 400);
    for (let attempt = 0; attempt < 2; attempt++) {
      const accessToken = await token();
      const { response, data } = await jsonRequest(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 401) { await tokens.invalidate(key, accessToken); if (attempt === 0) continue; }
      if (!response.ok || data === null) throw new GalenoError("service_error", "Galeno no pudo completar la consulta. Revisá la configuración o intentá nuevamente.");
      const result = data as { errorCode?: unknown; codigo?: unknown };
      if (result.errorCode || (result.codigo !== undefined && String(result.codigo) !== "0" && !Array.isArray(data))) throw new GalenoError("rejected", "Galeno rechazó la consulta. Revisá el plan y los parámetros configurados.");
      return data;
    }
    throw new GalenoError("authentication_failed", "No se pudo mantener la sesión con Galeno.");
  };
}
export type GalenoClient = ReturnType<typeof createGalenoClient>;
