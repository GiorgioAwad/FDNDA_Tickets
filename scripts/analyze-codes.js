const XLSX = require("xlsx");
const wb = XLSX.readFile("../servicios activos.xlsx");
const ws = wb.Sheets["AC y PL"];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
const acRows = data.slice(1).filter(r => r[0] === "AC").map(r => ({
  code: String(r[2]).trim(),
  desc: String(r[3]).trim().toUpperCase()
}));

function categorize(desc) {
  let disc = "OTROS", sede = "LIMA", clases = null;
  if (desc.includes("BECA")) disc = "BECA";
  else if (desc.includes("REINTEG")) disc = "REINTEGRO";
  else if (desc.includes("SEMILLERO")) disc = "SEMILLERO";
  else if (desc.includes("MASTER")) disc = "MASTER";
  else if (desc.includes("AQUABEBE")) disc = "AQUABEBE";
  else if (desc.includes("REHABILITACION")) disc = "REHABILITACION";
  else if (desc.includes("INCLUSION")) disc = "INCLUSION";
  else if (desc.includes("CLAVADOS")) disc = "CLAVADOS";
  else if (desc.includes("ARTISTICA")) disc = "NAT_ARTISTICA";
  else if (desc.includes("POLO") || desc.includes("WATER POLO")) disc = "POLO_ACUATICO";
  else if (desc.includes("NATACION") || desc.includes("NATACI")) disc = "NATACION";

  if (desc.includes("TRUJILLO")) sede = "TRUJILLO";
  else if (desc.includes("VMT") || desc.includes("VTM") || desc.includes("VILLA MARIA")) sede = "VMT";
  else if (desc.includes("HUANCHACO")) sede = "HUANCHACO";

  const m = desc.match(/(\d+)\s*CLASES/);
  if (m) clases = parseInt(m[1]);

  return { disc, sede, clases };
}

const combos = new Map();
acRows.forEach(r => {
  const { disc, sede, clases } = categorize(r.desc);
  const key = disc + "|" + sede + "|" + (clases || "X");
  if (!combos.has(key)) combos.set(key, { disc, sede, clases, count: 0, oldCodes: [] });
  const c = combos.get(key);
  c.count++;
  c.oldCodes.push(r.code);
});

const sedeMap = { LIMA: "L", VMT: "V", TRUJILLO: "T", HUANCHACO: "H" };
const discMap = {
  NATACION: "NAT", CLAVADOS: "CLV", NAT_ARTISTICA: "ART",
  POLO_ACUATICO: "POL", REHABILITACION: "RHB", INCLUSION: "INC",
  SEMILLERO: "SEM", AQUABEBE: "AQB", BECA: "BCA",
  MASTER: "MAS", REINTEGRO: "RNT", OTROS: "OTR"
};

const results = [];
combos.forEach((v, k) => {
  const s = sedeMap[v.sede] || "L";
  const d = discMap[v.disc] || "OTR";
  const c = v.clases ? String(v.clases).padStart(2, "0") : "XX";
  const codigo = s + d + c;
  const descParts = [];
  descParts.push(v.disc.replace(/_/g, " "));
  if (v.clases) descParts.push(v.clases + " clases");
  descParts.push("- " + v.sede);
  results.push({
    codigo, indicador: "AC", disciplina: v.disc,
    sede: v.sede, clases: v.clases,
    descripcion: descParts.join(" "),
    oldCount: v.count
  });
});

results.sort((a, b) => a.codigo.localeCompare(b.codigo));
console.log("Total codigos estandarizados:", results.length);
console.log("");
results.forEach(r => {
  console.log(r.codigo + " | " + r.descripcion + " | (reemplaza " + r.oldCount + " codigos)");
});

// Output as JSON for the seed script
console.log("\n\n=== JSON para seed ===");
console.log(JSON.stringify(results.map(r => ({
  codigo: r.codigo,
  indicador: r.indicador,
  disciplina: r.disciplina,
  sede: r.sede,
  clases: r.clases,
  descripcion: r.descripcion
})), null, 2));
