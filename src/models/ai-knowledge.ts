import { Schema, model } from "mongoose";

const aiConfigurationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true, maxlength: 120 },
  company: { type: String, required: true, trim: true, lowercase: true, index: true, maxlength: 80 },
  product: { type: String, required: true, trim: true, lowercase: true, index: true, maxlength: 80 },
  title: { type: String, default: "", trim: true, maxlength: 180 },
  placeholder: { type: String, default: "¿Qué querés saber?", trim: true, maxlength: 240 },
  welcomeMessage: { type: String, default: "", trim: true, maxlength: 500 },
  fallbackMessage: { type: String, required: true, trim: true, maxlength: 500 },
  systemInstructions: { type: String, default: "", trim: true, maxlength: 4000 },
  active: { type: Boolean, default: false, index: true },
  knowledgeVersion: { type: Number, default: 1, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

const aiDocumentSchema = new Schema({
  configurationIds: [{ type: Schema.Types.ObjectId, ref: "AIConfiguration", index: true }],
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  storedName: { type: String, required: true, trim: true, maxlength: 255 },
  mimeType: { type: String, required: true, enum: ["application/pdf"] },
  sizeBytes: { type: Number, required: true },
  status: { type: String, enum: ["pending", "processing", "ready", "error"], default: "pending", index: true },
  pageCount: Number,
  chunkCount: { type: Number, default: 0 },
  error: String,
  version: { type: Number, default: 1 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

const aiChunkSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, ref: "AIDocument", required: true, index: true },
  configurationIds: [{ type: Schema.Types.ObjectId, ref: "AIConfiguration", required: true, index: true }],
  text: { type: String, required: true, maxlength: 20000 },
  page: Number,
  chunkIndex: { type: Number, required: true },
  embedding: { type: [Number], required: true },
  documentName: { type: String, required: true },
}, { timestamps: true });
aiChunkSchema.index({ configurationIds: 1, documentId: 1 });

const aiQuerySchema = new Schema({
  configurationId: { type: Schema.Types.ObjectId, ref: "AIConfiguration", required: true, index: true },
  question: { type: String, required: true, maxlength: 500 },
  answer: { type: String, required: true, maxlength: 12000 },
  sources: [{ document: String, page: Number }],
  cacheHit: { type: Boolean, default: false },
  providerCalled: { type: Boolean, default: false },
  durationMs: Number,
  status: { type: String, enum: ["success", "fallback", "error"], required: true },
  error: String,
  knowledgeVersion: { type: Number, required: true },
  ipHash: String,
}, { timestamps: true });

export const AIConfiguration = model("AIConfiguration", aiConfigurationSchema);
export const AIDocument = model("AIDocument", aiDocumentSchema);
export const AIChunk = model("AIChunk", aiChunkSchema);
export const AIQuery = model("AIQuery", aiQuerySchema);
