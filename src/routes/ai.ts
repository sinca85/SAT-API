import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { del, get } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { AIConfiguration, AIQuery, AIDocument, AIChunk } from "../models/ai-knowledge.js";
import { answerQuestion, consumeRateLimit, createDocument } from "../services/ai-knowledge.js";
import { geminiProvider } from "../integrations/ai/gemini.js";
import { env } from "../config/env.js";

export const aiRouter = Router();
const questionSchema = z.object({ question: z.string().trim().min(1).max(env.AI_CHAT_MAX_QUESTION_LENGTH) });

aiRouter.get("/chat/:slug/config", async (request, response) => {
  const configuration = await AIConfiguration.findOne({ slug: request.params.slug.toLowerCase(), active: true }).select("slug title placeholder welcomeMessage active").lean();
  if (!configuration) { response.status(404).json({ success: false, error: "Assistant not found" }); return; }
  response.json({ slug: configuration.slug, title: configuration.title, placeholder: configuration.placeholder, welcomeMessage: configuration.welcomeMessage, active: configuration.active });
});

aiRouter.post("/chat/:slug", async (request, response) => {
  const startedAt = Date.now();
  const configuration = await AIConfiguration.findOne({ slug: request.params.slug.toLowerCase(), active: true });
  if (!configuration) { response.status(404).json({ success: false, error: "Assistant not found" }); return; }
  const input = questionSchema.parse(request.body);
  const ip = request.ip || "unknown";
  if (!consumeRateLimit(`${ip}:${configuration.id}`)) { response.status(429).json({ success: false, error: "Alcanzaste el límite de consultas. Intentá nuevamente en un minuto." }); return; }
  try {
    const result = await answerQuestion(configuration, input.question);
    await AIQuery.create({ configurationId: configuration._id, question: input.question, answer: result.answer, sources: result.sources, cacheHit: result.cacheHit, providerCalled: result.providerCalled, durationMs: Date.now() - startedAt, status: result.fallback ? "fallback" : "success", knowledgeVersion: configuration.knowledgeVersion });
    response.json({ success: true, answer: result.answer, sources: result.sources });
  } catch (error) {
    await AIQuery.create({ configurationId: configuration._id, question: input.question, answer: configuration.fallbackMessage, sources: [], providerCalled: true, durationMs: Date.now() - startedAt, status: "error", error: error instanceof Error ? error.message : "AI provider error", knowledgeVersion: configuration.knowledgeVersion });
    response.json({ success: true, answer: configuration.fallbackMessage, sources: [] });
  }
});

export const aiAdminRouter = Router();
aiAdminRouter.use(requireAuthentication, requireActiveUser, requirePermission("ai.view"));
const configurationInput = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), company: z.string().trim().min(2).max(80), product: z.string().trim().min(2).max(80), title: z.string().trim().max(180).default(""), placeholder: z.string().trim().max(240).default("¿Qué querés saber?"), welcomeMessage: z.string().trim().max(500).default(""), fallbackMessage: z.string().trim().min(5).max(500), outOfScopeMessage: z.string().trim().min(5).max(500).default("Puedo ayudarte únicamente con consultas sobre este seguro."), systemInstructions: z.string().trim().max(4000).default(""), active: z.boolean().default(false) });
const canManage = (request: import("express").Request) => request.user!.permissions.includes("*") || request.user!.permissions.includes("ai.manage");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.AI_MAX_DOCUMENT_BYTES, files: 20 }, fileFilter: (_request, file, callback) => callback(null, file.mimetype === "application/pdf") });

async function processPdfBuffer(input: { configurationId: string; originalName: string; sizeBytes: number; buffer: Buffer; uploadedBy: string; blobUrl?: string }) {
  const module = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (module.default ?? module) as unknown as (buffer: Buffer) => Promise<{ text: string }>;
  const parsed = await pdfParse(input.buffer);
  const document = await createDocument({ configurationIds: [input.configurationId], originalName: input.originalName, sizeBytes: input.sizeBytes, text: parsed.text, uploadedBy: input.uploadedBy });
  if (input.blobUrl) { document.set("blobUrl", input.blobUrl); await document.save(); }
  return document;
}

aiAdminRouter.get("/configurations", async (_request, response) => {
  response.json({ configurations: await AIConfiguration.find().select("-systemInstructions").sort({ company: 1, product: 1, name: 1 }).lean() });
});
aiAdminRouter.get("/configurations/:configurationId/diagnostics", async (request, response) => {
  const queries = await AIQuery.find({ configurationId: request.params.configurationId }).sort({ createdAt: -1 }).limit(5).select("status error createdAt providerCalled durationMs").lean();
  response.json({ queries });
});
aiAdminRouter.post("/configurations", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = configurationInput.parse(request.body);
  const configuration = await AIConfiguration.create({ ...input, company: input.company.toLowerCase(), product: input.product.toLowerCase(), createdBy: request.user!.id, updatedBy: request.user!.id });
  response.status(201).json({ configuration });
});
aiAdminRouter.patch("/configurations/:configurationId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = configurationInput.partial().parse(request.body);
  const configuration = await AIConfiguration.findByIdAndUpdate(request.params.configurationId, { ...input, updatedBy: request.user!.id }, { new: true, runValidators: true });
  if (!configuration) { response.status(404).json({ error: "Configuration not found" }); return; }
  response.json({ configuration });
});
aiAdminRouter.delete("/configurations/:configurationId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const configuration = await AIConfiguration.findByIdAndDelete(request.params.configurationId);
  if (!configuration) { response.status(404).json({ error: "Configuration not found" }); return; }
  await AIDocument.updateMany({ configurationIds: configuration._id }, { $pull: { configurationIds: configuration._id } });
  response.status(204).end();
});

aiAdminRouter.post("/configurations/:configurationId/documents", upload.array("files", 20), async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const configuration = await AIConfiguration.findById(request.params.configurationId);
  if (!configuration) { response.status(404).json({ error: "Configuration not found" }); return; }
  const files = (request.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) { response.status(400).json({ error: "At least one PDF file is required" }); return; }
  const documents = [];
  let pdfParse: (buffer: Buffer) => Promise<{ text: string }>;
  try {
    // Import the parser implementation directly. The package root of
    // pdf-parse@1.x runs its bundled test harness when loaded through ESM.
    const module = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = (module.default ?? module) as unknown as typeof pdfParse;
  } catch (error) {
    response.status(200).json({ documents: files.map((file) => ({ name: file.originalname, status: "error", chunkCount: 0, error: error instanceof Error ? error.message : "No se pudo cargar el lector PDF" })) });
    return;
  }
  for (const file of files) {
    try {
      const document = await processPdfBuffer({ configurationId: configuration.id, originalName: file.originalname, sizeBytes: file.size, buffer: file.buffer, uploadedBy: request.user!.id });
      documents.push({ id: document.id, name: file.originalname, status: document.status, chunkCount: document.chunkCount, error: document.error });
    } catch (error) {
      documents.push({ name: file.originalname, status: "error", chunkCount: 0, error: error instanceof Error ? error.message : "PDF processing failed" });
    }
  }
  response.status(200).json({ documents });
});

aiAdminRouter.post("/blob-upload", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  if (!env.BLOB_READ_WRITE_TOKEN) { response.status(503).json({ error: "Vercel Blob is not configured" }); return; }
  const result = await handleUpload({
    request,
    body: request.body as HandleUploadBody,
    token: env.BLOB_READ_WRITE_TOKEN,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith("ai-documents/")) throw new Error("Invalid upload path");
      return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 100 * 1024 * 1024, addRandomSuffix: true };
    },
  });
  response.json(result);
});

aiAdminRouter.post("/configurations/:configurationId/documents-from-blob", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = z.object({ url: z.string().url(), pathname: z.string().min(1), originalName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }).parse(request.body);
  const configuration = await AIConfiguration.findById(request.params.configurationId);
  if (!configuration) { response.status(404).json({ error: "Configuration not found" }); return; }
  const blob = await get(input.url, { access: "private", token: env.BLOB_READ_WRITE_TOKEN });
  if (!blob) { response.status(404).json({ error: "Blob not found" }); return; }
  const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
  try {
    const document = await processPdfBuffer({ configurationId: configuration.id, originalName: input.originalName, sizeBytes: input.sizeBytes, buffer, uploadedBy: request.user!.id, blobUrl: input.url });
    response.json({ document: { id: document.id, status: document.status, chunkCount: document.chunkCount, error: document.error } });
  } catch (error) { response.status(200).json({ document: { status: "error", error: error instanceof Error ? error.message : "Document processing failed" } }); }
});

aiAdminRouter.post("/configurations/:configurationId/browser-documents", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = z.object({ originalName: z.string().min(1).max(255), sizeBytes: z.number().int().positive(), pageCount: z.number().int().positive() }).parse(request.body);
  const configuration = await AIConfiguration.findById(request.params.configurationId);
  if (!configuration) { response.status(404).json({ error: "Configuration not found" }); return; }
  const document = await AIDocument.create({ configurationIds: [configuration.id], originalName: input.originalName, storedName: input.originalName.replace(/[^a-zA-Z0-9._-]/g, "_"), mimeType: "application/pdf", sizeBytes: input.sizeBytes, pageCount: input.pageCount, status: "processing", uploadedBy: request.user!.id });
  response.status(201).json({ documentId: document.id });
});

aiAdminRouter.post("/documents/:documentId/browser-chunks", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = z.object({ chunks: z.array(z.object({ text: z.string().min(1).max(6000), page: z.number().int().positive(), chunkIndex: z.number().int().nonnegative() })).min(1).max(10) }).parse(request.body);
  const document = await AIDocument.findById(request.params.documentId);
  if (!document) { response.status(404).json({ error: "Document not found" }); return; }
  for (const chunk of input.chunks) await AIChunk.create({ documentId: document.id, configurationIds: document.configurationIds, text: chunk.text, page: chunk.page, chunkIndex: chunk.chunkIndex, embedding: await geminiProvider.embed(chunk.text), documentName: document.originalName });
  document.chunkCount += input.chunks.length; await document.save();
  response.json({ chunkCount: document.chunkCount });
});

aiAdminRouter.post("/documents/:documentId/browser-complete", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const document = await AIDocument.findById(request.params.documentId);
  if (!document) { response.status(404).json({ error: "Document not found" }); return; }
  document.status = "ready"; await document.save();
  await AIConfiguration.updateMany({ _id: { $in: document.configurationIds } }, { $inc: { knowledgeVersion: 1 } });
  response.json({ document: { id: document.id, status: document.status, chunkCount: document.chunkCount } });
});

aiAdminRouter.delete("/documents/:documentId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const document = await AIDocument.findByIdAndDelete(request.params.documentId);
  if (!document) { response.status(404).json({ error: "Document not found" }); return; }
  await AIChunk.deleteMany({ documentId: document._id });
  const blobUrl = document.get("blobUrl") as string | undefined;
  if (blobUrl && env.BLOB_READ_WRITE_TOKEN) await del(blobUrl, { token: env.BLOB_READ_WRITE_TOKEN });
  await AIConfiguration.updateMany({ _id: { $in: document.configurationIds } }, { $inc: { knowledgeVersion: 1 } });
  response.status(204).end();
});

aiAdminRouter.get("/documents/:configurationId", async (request, response) => {
  response.json({ documents: await AIDocument.find({ configurationIds: request.params.configurationId }).select("originalName sizeBytes status pageCount chunkCount error version createdAt updatedAt").lean() });
});
