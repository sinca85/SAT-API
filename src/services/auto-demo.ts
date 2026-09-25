import type { AutoQuoteInput, Option } from "./galeno-quotes.js";

export const autoDemoEnabled = () => process.env.AUTO_QUOTE_DEMO_MODE === "true";

const vehicles = [
  { brand: "ford", brandLabel: "Ford", model: "focus", modelLabel: "Focus", years: ["2023", "2022", "2021"], versions: ["SE 1.6", "SE Plus 2.0", "Titanium 2.0"] },
  { brand: "toyota", brandLabel: "Toyota", model: "corolla", modelLabel: "Corolla", years: ["2024", "2023", "2022"], versions: ["XLI 2.0 CVT", "XEI 2.0 CVT", "SEG 2.0 CVT"] },
  { brand: "volkswagen", brandLabel: "Volkswagen", model: "polo", modelLabel: "Polo", years: ["2024", "2023", "2022"], versions: ["Track 1.0", "Comfortline 1.0 TSI", "Highline 1.0 TSI"] },
  { brand: "chevrolet", brandLabel: "Chevrolet", model: "onix", modelLabel: "Onix", years: ["2024", "2023", "2022"], versions: ["LT 1.0", "LTZ 1.0 Turbo", "Premier 1.0 Turbo"] },
  { brand: "renault", brandLabel: "Renault", model: "sandero", modelLabel: "Sandero", years: ["2023", "2022", "2021"], versions: ["Life 1.6", "Zen 1.6", "Intens 1.6 CVT"] },
] as const;

const option = (value: string, label: string): Option => ({ value, label });

export function demoCatalog(input: { kind: "brands" | "models" | "years" | "versions" | "locations"; brand?: string; model?: string; year?: string; postalCode?: string }): Option[] {
  if (input.kind === "brands") return vehicles.map(item => option(item.brand, item.brandLabel));
  if (input.kind === "locations") return [option(`${input.postalCode}-1`, `Localidad ${input.postalCode}`)];
  const matching = vehicles.filter(item => !input.brand || item.brand === input.brand);
  if (input.kind === "models") return matching.map(item => option(item.model, item.modelLabel));
  const vehicle = matching.find(item => item.model === input.model);
  if (!vehicle) return [];
  if (input.kind === "years") return vehicle.years.map(year => option(year, year));
  if (!input.year || !vehicle.years.includes(input.year as never)) return [];
  return vehicle.versions.map((label, index) => option(`${vehicle.brand}:${vehicle.model}:${index + 1}`, label));
}

export function demoQuote(input: AutoQuoteInput) {
  const vehicle = vehicles.find(item => item.brand === input.brand && item.model === input.model);
  const versionIndex = Number(input.version.split(":").at(-1)) - 1;
  const version = vehicle?.versions[versionIndex] ?? "Versión seleccionada";
  const yearAdjustment = Math.max(0, Number(input.year) - 2021) * 1_150_000;
  const insuredAmount = 15_800_000 + yearAdjustment + Math.max(0, versionIndex) * 1_350_000 + (input.gnc ? input.gncValue : 0);
  const base = Math.round(insuredAmount * 0.0041);
  const coverage = (code: string, name: string, factor: number, benefits: string[], deductible = "") => {
    const firstInstallment = Math.round(base * factor);
    return { code, name, premium: firstInstallment * 12, firstInstallment, remainingInstallment: firstInstallment, benefits, deductible };
  };
  return {
    environment: "test" as const,
    requestId: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    vehicle: `${vehicle?.brandLabel ?? input.brand} ${vehicle?.modelLabel ?? input.model} ${version} · ${input.year}`,
    insuredAmount,
    hasRestrictions: false,
    billing: { mode: "Mensual", condition: "Contado", method: "Tarjeta de crédito" },
    coverages: [
      coverage("C", "Terceros Completo Clásica", 0.76, ["Responsabilidad civil", "Robo e incendio total y parcial", "Daño total por accidente", "Asistencia al vehículo"]),
      coverage("C2", "Terceros Completo Platinum", 0.94, ["Responsabilidad civil", "Robo e incendio total y parcial", "Cristales, granizo e inundación con límites", "Robo de ruedas", "Asistencia al vehículo"]),
      coverage("D", "Todo Riesgo con Franquicia", 1.32, ["Responsabilidad civil", "Robo e incendio total y parcial", "Daños parciales por accidente", "Cristales, granizo e inundación", "Asistencia Premium"], "4% de la suma asegurada"),
    ],
  };
}
