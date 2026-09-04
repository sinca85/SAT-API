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

let cache: { expiresAt: number; grid: HomeQuoteGrid } | undefined;

function normalizeLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

function parseMoney(value: string) {
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid quote value: ${value}`);
  return parsed;
}

function parseGrid(tsv: string): HomeQuoteGrid {
  const lines = tsv.split(/\r?\n/).map((line) => line.split("\t"));
  const headerIndex = lines.findIndex(([label]) => normalizeLabel(label ?? "").startsWith("coberturas / metros cuadrados"));
  if (headerIndex < 0) throw new Error("Home quote spreadsheet header was not found");
  const header = lines[headerIndex];
  if (!header) throw new Error("Home quote spreadsheet header was not found");
  const squareMeters = header.slice(1).filter(Boolean).map((value) => Number(value.trim()));
  if (!squareMeters.length || squareMeters.some((value) => !Number.isFinite(value))) throw new Error("Home quote spreadsheet has invalid square meters");
  const rows = new Map<string, string[]>();
  for (const row of lines.slice(headerIndex + 1)) {
    const label = normalizeLabel(row[0] ?? "");
    if (label) rows.set(label, row.slice(1, squareMeters.length + 1));
  }
  return { squareMeters, rows };
}

async function getGrid() {
  if (cache && cache.expiresAt > Date.now()) return cache.grid;
  const response = await fetch(HOME_QUOTES_TSV_URL, { headers: { Accept: "text/tab-separated-values" } });
  if (!response.ok) throw new Error(`Home quote spreadsheet failed with status ${response.status}`);
  const grid = parseGrid(await response.text());
  cache = { grid, expiresAt: Date.now() + CACHE_TTL_MS };
  return grid;
}

function findRow(grid: HomeQuoteGrid, startsWith: string) {
  const entry = [...grid.rows.entries()].find(([label]) => label.startsWith(startsWith));
  if (!entry) throw new Error(`Home quote spreadsheet row "${startsWith}" was not found`);
  return entry[1];
}

export async function getHomeQuote(requestedSquareMeters: number): Promise<HomeQuote> {
  const grid = await getGrid();
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

export async function getHomeQuoteOptions() {
  return (await getGrid()).squareMeters;
}
