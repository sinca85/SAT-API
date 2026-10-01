import { Schema, model } from "mongoose";

const autoInterestSchema = new Schema({
  submissionId: { type: String, required: true, unique: true, index: true },
  requestId: { type: String, default: "", trim: true },
  vehicle: { type: String, required: true, trim: true },
  coverageCode: { type: String, required: true, trim: true },
  coverageName: { type: String, required: true, trim: true },
  monthlyPrice: { type: Number, required: true },
  deductible: { type: String, default: "", trim: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  dni: { type: String, required: true, trim: true },
  dateOfBirth: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  postalCode: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  licensePlate: { type: String, required: true, trim: true, uppercase: true },
  engineNumber: { type: String, required: true, trim: true, uppercase: true },
  chassisNumber: { type: String, required: true, trim: true, uppercase: true },
  status: { type: String, enum: ["interested"], default: "interested", required: true },
}, { timestamps: true });

export const AutoInterest = model("AutoInterest", autoInterestSchema);
