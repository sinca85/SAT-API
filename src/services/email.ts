import { env } from "../config/env.js";
import type { HomeQuote } from "./home-quotes.js";

const money = (amount: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(amount);
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);

export async function sendHomeQuoteEmail(input: { name: string; email: string; homeType: string; quote: HomeQuote }) {
  if (!env.RESEND_API_KEY || !env.RESEND_EMAIL_DOMAIN) return { sent: false, reason: "not_configured" as const };
  const domain = env.RESEND_EMAIL_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const quote = input.quote;
  const recipientName = escapeHtml(input.name.trim().split(/\s+/)[0] || "");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `Seguro a Tiempo <cotizaciones@${domain}>`,
      to: [input.email],
      subject: `Tu cotización de Seguro Hogar: ${money(quote.monthlyPrice)} por mes`,
      html: `<!doctype html><html lang="es"><body style="margin:0;background:#f5f8fc;font-family:Arial,sans-serif;color:#17324d"><main style="max-width:620px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #dbe5f0"><header style="padding:28px 34px;background:#073ea7;color:#fff"><strong style="font-size:24px">Seguro a Tiempo</strong><p style="margin:8px 0 0;font-size:14px">Tu cotización de Seguro Hogar Allianz</p></header><section style="padding:32px 34px"><h1 style="margin:0 0 14px;font-size:25px">¡Listo, ${recipientName}!</h1><p style="line-height:1.55">Preparamos una cobertura para tu ${escapeHtml(input.homeType.toLowerCase())} de <strong>${quote.quotedSquareMeters} m²</strong>.</p><div style="margin:24px 0;padding:22px;border-radius:10px;background:#073ea7;color:#fff;text-align:center"><span style="font-size:12px;text-transform:uppercase">Cuota mensual</span><div style="margin:8px 0;font-size:34px;font-weight:700">${money(quote.monthlyPrice)} <span style="font-size:14px">/mes</span></div><strong style="color:#d9ff4f;font-size:13px">12 CUOTAS FIJAS · Póliza anual</strong></div><h2 style="font-size:18px">Coberturas incluidas</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody><tr><td style="padding:9px 0;border-bottom:1px solid #e6edf5">Incendio de estructura</td><td style="text-align:right;border-bottom:1px solid #e6edf5">${money(quote.structureCoverage)}</td></tr><tr><td style="padding:9px 0;border-bottom:1px solid #e6edf5">Incendio del contenido</td><td style="text-align:right;border-bottom:1px solid #e6edf5">${money(quote.contentsCoverage)}</td></tr><tr><td style="padding:9px 0;border-bottom:1px solid #e6edf5">Electrodomésticos</td><td style="text-align:right;border-bottom:1px solid #e6edf5">${money(quote.appliancesCoverage)}</td></tr><tr><td style="padding:9px 0;border-bottom:1px solid #e6edf5">Cristales</td><td style="text-align:right;border-bottom:1px solid #e6edf5">${money(quote.glassCoverage)}</td></tr><tr><td style="padding:9px 0;border-bottom:1px solid #e6edf5">Robo de contenido</td><td style="text-align:right;border-bottom:1px solid #e6edf5">${money(quote.theftCoverage)}</td></tr><tr><td style="padding:9px 0">Daños por agua</td><td style="text-align:right">${money(quote.waterDamageCoverage)}</td></tr></tbody></table><p style="margin:26px 0 0;line-height:1.55;color:#52657a">Un asesor puede ayudarte a completar la contratación y resolver tus dudas.</p></section></main></body></html>`,
      text: `Hola ${input.name},\n\nTu cotización de Seguro Hogar Allianz para ${input.homeType} de ${quote.quotedSquareMeters} m² es de ${money(quote.monthlyPrice)} por mes.\n\nIncluye incendio de estructura (${money(quote.structureCoverage)}), incendio del contenido (${money(quote.contentsCoverage)}), electrodomésticos (${money(quote.appliancesCoverage)}), cristales (${money(quote.glassCoverage)}), robo de contenido (${money(quote.theftCoverage)}) y daños por agua (${money(quote.waterDamageCoverage)}).`,
    }),
  });
  if (!response.ok) throw new Error(`Resend respondió ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const result = await response.json() as { id?: string };
  return { sent: true, id: result.id };
}

export async function sendEmailTest(to: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_EMAIL_DOMAIN) throw new Error("Faltan RESEND_API_KEY o RESEND_EMAIL_DOMAIN en las variables de entorno.");
  const domain = env.RESEND_EMAIL_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `Seguro a Tiempo <cotizaciones@${domain}>`,
      to: [to],
      subject: "Prueba de envío · Seguro a Tiempo",
      html: "<main style=\"font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:28px;border:1px solid #dbe5f0;border-radius:14px;color:#17324d\"><h1 style=\"margin:0 0 12px;color:#073ea7\">Seguro a Tiempo</h1><p>Este es un email de prueba enviado desde la plataforma de Seguro a Tiempo mediante Resend.</p><p>Si lo recibiste, la configuración de envío está funcionando correctamente.</p></main>",
      text: "Seguro a Tiempo: este es un email de prueba. Si lo recibiste, la configuración de envío está funcionando correctamente.",
    }),
  });
  if (!response.ok) throw new Error(`Resend respondió ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return await response.json() as { id?: string };
}
