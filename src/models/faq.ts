import { Schema, model } from "mongoose";

const faqSchema = new Schema(
  {
    insurer: { type: String, required: true, trim: true, lowercase: true, index: true, maxlength: 80 },
    product: { type: String, required: true, trim: true, lowercase: true, index: true, maxlength: 80 },
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answer: { type: String, required: true, trim: true, maxlength: 10000 },
    active: { type: Boolean, default: true, required: true, index: true },
    source: { type: String, default: "manual", trim: true, maxlength: 250 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

faqSchema.index({ insurer: 1, product: 1, question: 1 });

export const Faq = model("Faq", faqSchema);
