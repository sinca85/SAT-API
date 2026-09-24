import assert from "node:assert/strict";
import { test } from "node:test";
import { autoDefaults, type AutoConfiguration } from "../src/services/auto-settings.js";
import { encryptAutoSecret } from "../src/services/auto-secrets.js";
import { createGalenoClient, createGalenoTransport, GalenoError, type TokenStore, type GalenoClient } from "../src/services/galeno-client.js";
import { quoteInput, quoteAuto, normalizeQuote } from "../src/services/galeno-quotes.js";

process.env.GALENO_SETTINGS_ENCRYPTION_KEY = "cd".repeat(32);
const settings: AutoConfiguration = { ...autoDefaults, username: "test-user", passwordEncrypted: encryptAutoSecret("test-password"), producerCode: "987", commercialPlanCode: "PLAN", billingModeCode: "AN", paymentConditionCode: "12", paymentMethodCode: "3", personTypeCode: "2", useTypeCode: "2", ivaCode: "1", iibbCode: "X" };
function memoryTokens(): TokenStore {
  let cached = "", owner = "", fingerprint = "";
  return {
    async get(_key, fp) { return fp === fingerprint && cached ? cached : null; },
    async acquire(_key, newOwner) { if (owner) return false; owner = newOwner; return true; },
    async save(_key, currentOwner, fp, token) { assert.equal(currentOwner, owner); cached = token; fingerprint = fp; },
    async release(_key, currentOwner) { if (currentOwner === owner) owner = ""; },
    async invalidate(_key, token) { if (cached === token) cached = ""; },
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("Fixie is applied only by the Galeno transport and invalid proxy credentials are rejected", async () => {
  let receivedInit: RequestInit | undefined;
  const directFetch: typeof fetch = async (_url, init) => { receivedInit = init; return json({ ok: true }); };
  await createGalenoTransport("http://user:password@proxy.example:8080", directFetch)(`${autoDefaults.baseUrl}/health`, { method: "GET" });
  assert.ok((receivedInit as RequestInit & { dispatcher?: unknown }).dispatcher);
  await createGalenoTransport(undefined, directFetch)(`${autoDefaults.baseUrl}/health`, { method: "GET" });
  assert.equal((receivedInit as RequestInit & { dispatcher?: unknown }).dispatcher, undefined);
  assert.throws(() => createGalenoTransport("http://proxy.example:8080", directFetch), /no está configurada/);
});

test("Galeno shares tokens, refreshes once after 401 and sends credentials only to sandbox", async () => {
  let tokens = 0, authorized = 0, invalidateNext = false;
  const transport: typeof fetch = async (url, init) => {
    assert.ok(String(url).startsWith(autoDefaults.baseUrl));
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/seguridad/token")) {
      tokens++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("username"), "test-user"); assert.equal(body.get("password"), "test-password"); assert.equal(body.get("grant_type"), "password");
      return json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    authorized++; assert.match(String((init!.headers as Record<string, string>).Authorization), /^Bearer token-/);
    if (invalidateNext) { invalidateNext = false; return json({}, 401); }
    return json([{ codigo: "1", descripcion: "Marca" }]);
  };
  const store = memoryTokens();
  const first = createGalenoClient(settings, transport, store);
  const second = createGalenoClient(settings, transport, store);
  await Promise.all([first("/api/cotizadores/auto/marcas?rama=4"), second("/api/cotizadores/auto/marcas?rama=4")]);
  assert.equal(tokens, 1); assert.equal(authorized, 2);
  invalidateNext = true; await first("/api/cotizadores/auto/marcas?rama=4"); assert.equal(tokens, 2);
  assert.throws(() => createGalenoClient({ ...settings, baseUrl: "https://attacker.example" }, transport, store), /únicamente/);
  await assert.rejects(() => first("/api/cotizadores/auto/../emitir"), /no habilitado/);
});

test("Authentication and network failures are sanitized; no automatic quote retry on timeout", async () => {
  const rejected = createGalenoClient(settings, async () => json({ error_description: "test-password INTERNAL STACK" }, 400), memoryTokens());
  await assert.rejects(() => rejected("/api/cotizadores/auto/marcas?rama=4"), (error: Error) => error instanceof GalenoError && !error.message.includes("test-password"));
  let requests = 0;
  const broken = createGalenoClient(settings, async url => { if (String(url).endsWith("/seguridad/token")) return json({ access_token: "token", expires_in: 3600 }); requests++; throw new Error("network secret"); }, memoryTokens());
  await assert.rejects(() => broken("/api/cotizadores/auto/cotizar", {}), /comunicarnos/);
  assert.equal(requests, 1);
});

const quote = { solicitud: 101, descripcionVehiculo: "CHEVROLET AGILE LT 2016", sumaAsegurada: 8500000, coberturas: [
  { item: 1, cobertura: "C", descripcionCobertura: "TERCEROS COMPLETO", prima: 1, premio: 100000, importeCuota1: 10000, importeRestoCuotas: 9000, listaAdicionales: ["Robo e incendio", ""], franquicia: "" },
  { item: 2, cobertura: "D", descripcionCobertura: "TODO RIESGO", premio: 200000, importeCuota1: 20000, importeRestoCuotas: 19000, listaAdicionales: [], franquicia: "Según plan" },
], excepciones: [{ item: 2, estado: "No Permitido", detalle: "Restricted" }] };
function fixtureClient() {
  let payload: Record<string, unknown> | undefined;
  const client: GalenoClient = async (path, body) => {
    if (path.includes("planes/comerciales")) return { codigo: "0", lista: [{ codPlanComercial: "PLAN", productorCodigo: "987", descripcionPlanComercial: "Plan sandbox" }] };
    if (path.endsWith("tiposPersona")) return [{ codigo: "2", descripcion: "Persona jurídica" }];
    if (path.endsWith("tiposDeUso")) return [{ codigoUsoVehiculo: 2, descripcionUsoVehiculo: "COMERCIAL" }];
    if (path.endsWith("categoriasIva")) return [{ codigo: "1", descripcion: "Responsable inscripto" }];
    if (path.endsWith("codigosIIBB")) return [{ codigo: "X", descripcion: "Exento" }];
    if (path.endsWith("modosDeFacturacion")) { assert.equal(body?.planComercial, "PLAN"); return [{ codigo: "AN", descripcion: "ANUAL" }]; }
    if (path.endsWith("condicionesDePago")) { assert.equal(body?.modoFacturacion, "AN"); return [{ codigo: "12", descripcion: "12 CUOTAS" }]; }
    if (path.endsWith("formasDePago")) return [{ codigo: "3", descripcion: "TARJETA DE CREDITO" }];
    if (path.includes("submodelos")) return [{ version: "AGILE LT", codigoMarca: 12, codigoModelo: 463, codigoSubModelo: 1 }];
    if (path.includes("codigoPostal")) return [{ subCodigoPostal: "1", localidad: "Córdoba" }];
    if (path.endsWith("cotizar")) { payload = body; return quote; }
    throw new Error(`Unexpected path: ${path}`);
  };
  return { client, payload: () => payload };
}
const input = { brand: "12", model: "AGILE", year: "2016", version: "12:463:1", zeroKm: false, postalCode: "5000", locality: "1", startDate: "2099-10-23", gnc: true, gncValue: 300000, name: "Empresa prueba" };
test("Quote uses server-side commercial/person defaults and numeric version identifiers", async () => {
  const fixture = fixtureClient();
  const result = await quoteAuto(fixture.client, settings, quoteInput.parse(input));
  const payload = fixture.payload()!;
  assert.equal(payload.modeloCodigo, "463"); assert.equal(payload.tomadorTipoPersona, "2"); assert.equal(payload.tipoUso, "2");
  assert.equal(payload.tomadoCategoriaIVACodigo, "1"); assert.equal(payload.formaPagoCodigo, "3"); assert.equal(payload.vigenciaDesde, "23/10/2099");
  assert.equal(payload.accesorio1Codigo, "25"); assert.equal(payload.accesorio1Valor, 300000); assert.equal(payload.productorCodigo, "987");
  assert.equal(result.coverages.length, 1); assert.equal(result.coverages[0]?.premium, 100000); assert.equal(result.coverages[0]?.firstInstallment, 10000);
  assert.equal(result.billing.mode, "ANUAL"); assert.equal(result.billing.method, "TARJETA DE CREDITO");
});
test("Rejects public overrides, invalid vehicle/locality/payment and impossible dates", async () => {
  assert.equal(quoteInput.safeParse({ ...input, personTypeCode: "1" }).success, false);
  assert.equal(quoteInput.safeParse({ ...input, producerCode: "hijack" }).success, false);
  assert.equal(quoteInput.safeParse({ ...input, startDate: "2099-02-30" }).success, false);
  assert.equal(quoteInput.safeParse({ ...input, gncValue: 0 }).success, false);
  await assert.rejects(() => quoteAuto(fixtureClient().client, settings, { ...input, version: "12:999:1" }), /versión/);
  await assert.rejects(() => quoteAuto(fixtureClient().client, settings, { ...input, locality: "999" }), /localidad/);
  await assert.rejects(() => quoteAuto(fixtureClient().client, { ...settings, paymentMethodCode: "999" }, input), /opciones comerciales/);
});
test("Handles empty/restricted/error quotes without fabricated prices", () => {
  assert.equal(normalizeQuote({ coberturas: null, excepciones: null }).coverages.length, 0);
  assert.equal(normalizeQuote({ ...quote, excepciones: [{ item: 0, estado: "No Permitido", detalle: "Vigencia" }] }).coverages.length, 0);
  assert.throws(() => normalizeQuote({ errores: [{ descripcion: "invalid" }] }), /no pudo cotizar/);
  assert.throws(() => normalizeQuote({ coberturas: [{ premio: -1 }] }), /incompleta/);
});
