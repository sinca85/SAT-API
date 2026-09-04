import { env } from "../../config/env.js";
import { highLevelClient } from "./client.js";

interface CustomField {
  id: string;
  name: string;
  fieldKey: string;
}

interface CustomFieldsResponse {
  customFields?: CustomField[];
}

interface CreateCustomFieldResponse {
  customField: CustomField;
}

const requiredContactFields = [
  { key: "dni", name: "DNI", dataType: "TEXT" },
  { key: "piso", name: "Piso", dataType: "TEXT" },
  { key: "departamento", name: "Departamento", dataType: "TEXT" },
  { key: "tipo_vivienda", name: "Tipo de vivienda", dataType: "TEXT" },
  { key: "metros_cuadrados", name: "Metros cuadrados", dataType: "TEXT" },
  { key: "precio_mensual", name: "Precio mensual cotizado", dataType: "TEXT" },
  { key: "suma_asegurada_estructura", name: "Suma asegurada estructura", dataType: "TEXT" },
] as const;

let cachedFields: Record<string, string> | undefined;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export async function ensureHomeContactFields() {
  if (cachedFields) return cachedFields;
  const locationId = env.HIGHLEVEL_LOCATION_ID!;
  const response = await highLevelClient.request<CustomFieldsResponse>(
    `/locations/${encodeURIComponent(locationId)}/customFields`,
    { headers: { Version: "v3" } },
  );
  const available = [...(response.customFields ?? [])];
  const resolved: Record<string, string> = {};

  for (const definition of requiredContactFields) {
    let field = available.find(({ name, fieldKey }) =>
      normalized(name) === normalized(definition.name) || fieldKey.endsWith(`.${definition.key}`),
    );
    if (!field) {
      const created = await highLevelClient.request<CreateCustomFieldResponse>(
        `/locations/${encodeURIComponent(locationId)}/customFields`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Version: "v3" },
          body: JSON.stringify({ name: definition.name, dataType: definition.dataType, model: "contact" }),
        },
      );
      field = created.customField;
      available.push(field);
    }
    resolved[definition.key] = field.id;
  }

  cachedFields = resolved;
  return resolved;
}
