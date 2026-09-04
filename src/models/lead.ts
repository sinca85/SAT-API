import { Schema, model } from "mongoose";

export const leadStatuses = [
  "new",
  "pending_contact",
  "contacted",
  "follow_up",
  "interested",
  "quote_sent",
  "won",
  "not_interested",
  "not_qualified",
  "unresponsive",
] as const;

const leadNoteSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { _id: true },
);

const leadSchema = new Schema(
  {
    submissionId: { type: String, required: true, unique: true, index: true },
    source: { type: String, required: true, index: true },
    product: { type: String, required: true, index: true },
    insurer: { type: String, required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true, index: true },
    phone: { type: String, default: "", trim: true, index: true },
    personal: {
      firstName: { type: String, default: "", trim: true },
      lastName: { type: String, default: "", trim: true },
      dni: { type: String, default: "", trim: true },
      dateOfBirth: { type: String, default: "", trim: true },
      address: { type: String, default: "", trim: true },
      floor: { type: String, default: "", trim: true },
      apartment: { type: String, default: "", trim: true },
      postalCode: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      phone: { type: String, default: "", trim: true },
    },
    quote: {
      postalCode: { type: String, required: true },
      homeType: { type: String, required: true },
      floor: { type: String, required: true },
      areaCode: { type: String, required: true },
      requestedSquareMeters: { type: Number, required: true },
      quotedSquareMeters: { type: Number, required: true },
      areaLabel: { type: String, required: true },
      monthlyPrice: { type: Number, required: true },
      structureCoverage: { type: Number, required: true },
      contentsCoverage: { type: Number, required: true },
      appliancesCoverage: { type: Number, required: true },
      glassCoverage: { type: Number, required: true },
      theftCoverage: { type: Number, required: true },
      waterDamageCoverage: { type: Number, required: true },
      assistanceIncluded: { type: Boolean, default: true, required: true },
      currency: { type: String, default: "ARS", required: true },
    },
    origin: {
      landing: { type: String, default: "/hogar" },
      channel: { type: String, default: "landing" },
      pageUrl: String,
      referrer: String,
      utmSource: String,
      utmMedium: String,
      utmCampaign: String,
      utmContent: String,
      utmTerm: String,
    },
    status: { type: String, enum: leadStatuses, default: "new", required: true, index: true },
    pinned: { type: Boolean, default: false, required: true, index: true },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    nextFollowUpAt: Date,
    lossReason: String,
    notes: { type: [leadNoteSchema], default: [] },
    highLevel: {
      contactId: String,
      opportunityId: String,
      summaryNoteId: String,
      summaryNoteFingerprint: String,
      syncStatus: { type: String, enum: ["pending", "contact_synced", "synced", "failed"], default: "pending" },
      lastSyncedAt: Date,
      lastError: String,
    },
  },
  { timestamps: true },
);

leadSchema.index({ pinned: -1, createdAt: -1 });

export const Lead = model("Lead", leadSchema);
