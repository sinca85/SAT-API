import { HighLevelContact } from "../models/highlevel-contact.js";

export interface HighLevelContactInput {
  id?: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateAdded?: string;
  tags?: string[];
  [key: string]: unknown;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function contactValues(input: HighLevelContactInput) {
  const firstName = text(input.firstName);
  const lastName = text(input.lastName);
  const fullName = text(input.contactName) || [firstName, lastName].filter(Boolean).join(" ");
  const email = text(input.email).toLowerCase();
  const dateAdded = text(input.dateAdded);
  return {
    firstName,
    lastName,
    fullName,
    email,
    phone: text(input.phone),
    tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [],
    ...(dateAdded && !Number.isNaN(Date.parse(dateAdded)) ? { dateAdded: new Date(dateAdded) } : {}),
  };
}

/**
 * Stores a HighLevel contact locally. Email is used first to avoid producing a
 * second local entry when a landing lead later receives its HighLevel ID.
 */
export async function upsertHighLevelContact(input: HighLevelContactInput) {
  const values = contactValues(input);
  const highLevelId = text(input.id);
  const existing = (highLevelId ? await HighLevelContact.findOne({ highLevelId }) : null)
    ?? (values.email ? await HighLevelContact.findOne({ email: values.email }).sort({ updatedAt: -1 }) : null);

  if (existing) {
    Object.assign(existing, values, {
      ...(highLevelId ? { highLevelId } : {}),
      source: "highlevel",
      highLevelData: input,
      lastHighLevelSyncAt: new Date(),
    });
    await existing.save();
    return { contact: existing, created: false };
  }

  const contact = await HighLevelContact.create({
    ...values,
    ...(highLevelId ? { highLevelId } : {}),
    source: "highlevel",
    highLevelData: input,
    lastHighLevelSyncAt: new Date(),
  });
  return { contact, created: true };
}

/** Keeps the API contact directory in sync when a landing creates or updates a lead. */
export async function upsertLandingContact(input: { fullName: string; firstName?: string; lastName?: string; email?: string; phone?: string; highLevelId?: string }) {
  const email = text(input.email).toLowerCase();
  const highLevelId = text(input.highLevelId);
  const existing = (highLevelId ? await HighLevelContact.findOne({ highLevelId }) : null)
    ?? (email ? await HighLevelContact.findOne({ email }).sort({ updatedAt: -1 }) : null);
  const values = {
    fullName: text(input.fullName),
    firstName: text(input.firstName),
    lastName: text(input.lastName),
    email,
    phone: text(input.phone),
  };

  if (existing) {
    Object.assign(existing, values, highLevelId ? { highLevelId } : {});
    await existing.save();
    return existing;
  }
  return HighLevelContact.create({ ...values, ...(highLevelId ? { highLevelId } : {}), source: "landing" });
}
