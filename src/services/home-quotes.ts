const HOME_QUOTES_TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSi0Zo1Q5tgsM8njcISKbjwzhkNokFZ49-zShK_0DX-HDaW9OHXVKCdtPfRAYb5rw/pub?gid=1092676322&single=true&output=tsv";
const CACHE_TTL_MS = 60 * 1000;

export interface HomeQuote {
  requestedSquareMeters: number;
  quotedSquareMeters: number;
  areaLabel: string;
  monthlyPrice: number;
  structureCoverage: number;
  contentsCoverage: number;
  appliancesCoverage: number;
  glassCoverage: number;
  theftCoverage: number;
  waterDamageCoverage: number;
  assistanceIncluded: boolean;
  currency: "ARS";
}

interface HomeQuoteGrid {
  squareMeters: number[];
  rows: Map<string, string[]>;
}

export type HomeType = "Casa" | "Departamento" | "PH" | "Barrio privado";
type QuoteCategory = "departamento" | "casa-ph-country";
type HomeQuoteCatalog = Map<QuoteCategory, HomeQuoteGrid>;

let cache: { expiresAt: number; catalog: HomeQuoteCatalog } | undefined;

function normalizeLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function parseMoney(value: string) {
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid quote value: ${value}`);
  return parsed;
}

function categoryForHomeType(homeType: HomeType): QuoteCategory {
  return homeType === "Departamento" ? "departamento" : "casa-ph-country";
}

function parseCatalog(tsv: string): HomeQuoteCatalog {
  const lines = tsv.split(/\r?\n/).map((line) => line.split("\t"));
  const catalog: HomeQuoteCatalog = new Map();
  let activeCategory: QuoteCategory | undefined;
  let activeGrid: HomeQuoteGrid | undefined;

  for (const row of lines) {
    const label = normalizeLabel(row[0] ?? "");
    if (label === "departamento") {
      activeCategory = "departamento";
      activeGrid = undefined;
      continue;
    }
    if (label.includes("casa") && label.includes("ph") && label.includes("country")) {
      activeCategory = "casa-ph-country";
      activeGrid = undefined;
      continue;
    }
    if (label.startsWith("coberturas / metros cuadrados")) {
      if (!activeCategory) continue;
      const squareMeters = row.slice(1).filter(Boolean).map((value) => Number(value.trim()));
      if (!squareMeters.length || squareMeters.some((value) => !Number.isFinite(value))) throw new Error("Home quote spreadsheet has invalid square meters");
      activeGrid = { squareMeters, rows: new Map() };
      catalog.set(activeCategory, activeGrid);
      continue;
    }
    if (label && activeGrid) activeGrid.rows.set(label, row.slice(1, activeGrid.squareMeters.length + 1));
  }
  if (!catalog.has("departamento") || !catalog.has("casa-ph-country")) throw new Error("Home quote spreadsheet is missing a housing category");
  return catalog;
}

async function getCatalog() {
  if (cache && cache.expiresAt > Date.now()) return cache.catalog;
  const response = await fetch(HOME_QUOTES_TSV_URL, { headers: { Accept: "text/tab-separated-values" } });
  if (!response.ok) throw new Error(`Home quote spreadsheet failed with status ${response.status}`);
  const catalog = parseCatalog(await response.text());
  cache = { catalog, expiresAt: Date.now() + CACHE_TTL_MS };
  return catalog;
}

async function getGrid(homeType: HomeType) {
  const category = categoryForHomeType(homeType);
  const grid = (await getCatalog()).get(category);
  if (!grid) throw new Error(`Home quote spreadsheet category "${category}" was not found`);
  return grid;
}

function findRow(grid: HomeQuoteGrid, startsWith: string) {
  const entry = [...grid.rows.entries()].find(([label]) => label.startsWith(startsWith));
  if (!entry) throw new Error(`Home quote spreadsheet row "${startsWith}" was not found`);
  return entry[1];
}

export async function getHomeQuote(requestedSquareMeters: number, homeType: HomeType): Promise<HomeQuote> {
  const grid = await getGrid(homeType);
  const min = grid.squareMeters[0]!;
  const max = grid.squareMeters.at(-1)!;
  if (!Number.isInteger(requestedSquareMeters) || !grid.squareMeters.includes(requestedSquareMeters)) {
    throw new Error(`Square meters must match a spreadsheet option between ${min} and ${max}`);
  }
  const quotedSquareMeters = requestedSquareMeters;
  const index = grid.squareMeters.indexOf(quotedSquareMeters);
  const money = (label: string) => parseMoney(findRow(grid, label)[index] ?? "");
  return {
    requestedSquareMeters,
    quotedSquareMeters,
    areaLabel: `${quotedSquareMeters} m²`,
    monthlyPrice: money("cuota mensual"),
    structureCoverage: money("incendio estructura"),
    contentsCoverage: money("incendio del contenido"),
    appliancesCoverage: money("electrodomesticos"),
    glassCoverage: money("cristales"),
    theftCoverage: money("robo de contenido"),
    waterDamageCoverage: money("danos por agua"),
    assistanceIncluded: true,
    currency: "ARS",
  };
}

export async function getHomeQuoteOptions(homeType: HomeType) {
  return (await getGrid(homeType)).squareMeters;
}
