import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { Faq } from "../models/faq.js";

const faqInput = z.object({
  insurer: z.string().trim().min(2).max(80),
  product: z.string().trim().min(2).max(80),
  question: z.string().trim().min(5).max(500),
  answer: z.string().trim().min(5).max(10000),
  active: z.boolean().default(true),
  source: z.string().trim().max(250).default("manual"),
});

const faqImportInput = z.object({
  faqs: z.array(faqInput).min(1).max(500),
});

const querySchema = z.object({
  insurer: z.string().trim().optional(),
  product: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
});

function canManage(request: Express.Request) {
  return request.user!.permissions.includes("*") || request.user!.permissions.includes("faqs.manage");
}

export const adminFaqsRouter = Router();
adminFaqsRouter.use(requireAuthentication, requireActiveUser, requirePermission("faqs.view"));

adminFaqsRouter.get("/", async (request, response) => {
  const input = querySchema.parse(request.query);
  const filter = {
    ...(input.insurer ? { insurer: input.insurer.toLowerCase() } : {}),
    ...(input.product ? { product: input.product.toLowerCase() } : {}),
    ...(input.search ? { $or: [{ question: { $regex: input.search, $options: "i" } }, { answer: { $regex: input.search, $options: "i" } }] } : {}),
  };
  const faqs = await Faq.find(filter).sort({ insurer: 1, product: 1, createdAt: -1 }).lean();
  const facets = await Faq.aggregate([{ $group: { _id: null, insurers: { $addToSet: "$insurer" }, products: { $addToSet: "$product" } } }]);
  response.json({ faqs, insurers: facets[0]?.insurers ?? [], products: facets[0]?.products ?? [] });
});

adminFaqsRouter.post("/", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = faqInput.parse(request.body);
  const faq = await Faq.create({ ...input, createdBy: request.user!.id, updatedBy: request.user!.id });
  response.status(201).json({ faq });
});

adminFaqsRouter.post("/import", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = faqImportInput.parse(request.body);
  const uniqueFaqs = Array.from(
    new Map(input.faqs.map((faq) => [`${faq.insurer.toLowerCase()}\u0000${faq.product.toLowerCase()}\u0000${faq.question}`, faq])).values(),
  );
  const questions = uniqueFaqs.map((faq) => faq.question);
  const existing = await Faq.find({ question: { $in: questions } }, { insurer: 1, product: 1, question: 1 }).lean();
  const existingKeys = new Set(existing.map((faq) => `${faq.insurer}\u0000${faq.product}\u0000${faq.question}`));
  const userId = new Types.ObjectId(request.user!.id);

  await Faq.bulkWrite(uniqueFaqs.map((faq) => ({
    updateOne: {
      filter: { insurer: faq.insurer.toLowerCase(), product: faq.product.toLowerCase(), question: faq.question },
      update: {
        $set: { answer: faq.answer, active: faq.active, source: faq.source, updatedBy: userId },
        $setOnInsert: { insurer: faq.insurer, product: faq.product, question: faq.question, createdBy: userId },
      },
      upsert: true,
    },
  })));

  const updated = uniqueFaqs.filter((faq) => existingKeys.has(`${faq.insurer.toLowerCase()}\u0000${faq.product.toLowerCase()}\u0000${faq.question}`)).length;
  response.status(201).json({ total: uniqueFaqs.length, created: uniqueFaqs.length - updated, updated });
});

adminFaqsRouter.patch("/:faqId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = faqInput.partial().parse(request.body);
  const faq = await Faq.findByIdAndUpdate(request.params.faqId, { ...input, updatedBy: request.user!.id }, { new: true, runValidators: true });
  if (!faq) { response.status(404).json({ error: "FAQ not found" }); return; }
  response.json({ faq });
});

adminFaqsRouter.delete("/:faqId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const faq = await Faq.findByIdAndDelete(request.params.faqId);
  if (!faq) { response.status(404).json({ error: "FAQ not found" }); return; }
  response.status(204).end();
});
