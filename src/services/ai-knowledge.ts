import { createHash } from "node:crypto";
import { AIDocument, AIChunk, AIConfiguration, AIQuery } from "../models/ai-knowledge.js";
import { geminiProvider } from "../integrations/ai/gemini.js";
import { env } from "../config/env.js";

const baseInstruction = "Sos un asesor amable de Seguro a Tiempo. Respondé exclusivamente utilizando el contexto documental proporcionado. No utilices conocimiento externo. No inventes coberturas, exclusiones, sumas aseguradas, límites, franquicias, condiciones ni requisitos. Si la respuesta no puede determinarse claramente a partir del contexto, indicá amablemente que necesitás que un asesor lo confirme. Hablale directamente a la persona: explicá qué incluye, qué aplica o qué debe hacer, con frases claras y concretas. No menciones documentación, fuentes, PDFs, páginas, instrucciones internas, prompts, embeddings, chunks ni contexto RAG. No uses Markdown, títulos, hashtags ni listas con símbolos.";
const cache = new Map<string, { expiresAt: number; answer: string; sources: Array<{ document: string; page?: number }> }>();
const rate = new Map<string, number[]>();

function cosine(a: number[], b: number[]) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) { dot += a[i]! * b[i]!; aa += a[i]! * a[i]!; bb += b[i]! * b[i]!; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

export function consumeRateLimit(key: string) {
  const now = Date.now();
  const values = (rate.get(key) ?? []).filter((timestamp) => now - timestamp < 86_400_000);
  if (values.filter((timestamp) => now - timestamp < 60_000).length >= env.AI_CHAT_RATE_PER_MINUTE || values.length >= env.AI_CHAT_DAILY_RATE) return false;
  values.push(now); rate.set(key, values); return true;
}

export async function createDocument(input: { configurationIds: string[]; originalName: string; sizeBytes: number; text: string; uploadedBy: string }) {
  const document = await AIDocument.create({ configurationIds: input.configurationIds, originalName: input.originalName, storedName: input.originalName.replace(/[^a-zA-Z0-9._-]/g, "_"), mimeType: "application/pdf", sizeBytes: input.sizeBytes, status: "processing", uploadedBy: input.uploadedBy });
  try {
    const sections = input.text.split(/\f+/).map((text, index) => ({ text: text.trim(), page: index + 1 })).filter(({ text }) => text);
    const chunks: Array<{ text: string; page: number; chunkIndex: number }> = [];
    sections.forEach(({ text, page }) => { for (let offset = 0; offset < text.length; offset += 5000) chunks.push({ text: text.slice(offset, offset + 5000), page, chunkIndex: chunks.length }); });
    for (const chunk of chunks) await AIChunk.create({ ...chunk, documentId: document.id, configurationIds: input.configurationIds, embedding: await geminiProvider.embed(chunk.text), documentName: input.originalName });
    document.status = "ready"; document.chunkCount = chunks.length; document.pageCount = sections.length; await document.save();
    await AIConfiguration.updateMany({ _id: { $in: input.configurationIds } }, { $inc: { knowledgeVersion: 1 } });
  } catch (error) { document.status = "error"; document.error = error instanceof Error ? error.message : "Document processing failed"; await document.save(); }
  return document;
}

export async function answerQuestion(configuration: InstanceType<typeof AIConfiguration>, question: string) {
  const normalized = question.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");
  const cacheKey = `customer-answer-v2:${configuration.id}:${configuration.knowledgeVersion}:${createHash("sha256").update(normalized).digest("hex")}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached, cacheHit: true, providerCalled: false };
  const queryEmbedding = await geminiProvider.embed(question);
  const chunks = await AIChunk.find({ configurationIds: configuration._id }).lean();
  // Insurance manuals often use very different wording from a customer's
  // question. Keep the best documentary matches and let the strict system
  // instruction decide whether the evidence actually answers the question.
  const matches = chunks.map((chunk) => ({ chunk, score: cosine(queryEmbedding, chunk.embedding) })).filter(({ score }) => score > 0.05).sort((a, b) => b.score - a.score).slice(0, 5);
  if (!matches.length) return { answer: configuration.fallbackMessage, sources: [], cacheHit: false, providerCalled: false, fallback: true };
  const context = matches.map(({ chunk }) => `[${chunk.documentName}${chunk.page ? `, página ${chunk.page}` : ""}]\n${chunk.text}`).join("\n\n");
  const answer = await geminiProvider.answer({ systemInstruction: `${baseInstruction}\nInstrucciones adicionales de configuración (subordinadas a las anteriores): ${configuration.systemInstructions || "ninguna"}`, question, context, maxOutputTokens: 600 });
  const sources = matches.map(({ chunk }) => ({ document: chunk.documentName, ...(chunk.page ? { page: chunk.page } : {}) }));
  cache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, answer, sources });
  return { answer, sources, cacheHit: false, providerCalled: true, fallback: !answer };
}

export { AIQuery };
