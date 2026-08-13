import ExcelJS from "exceljs";
import { money, normalizeSku } from "./rules.js";

function getValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "")
    .toLowerCase();
}

function normalizeRows(rows) {
  return rows
    .map((row) => {
      const normalized = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[normalizeHeader(key)] = value;
      });

      return {
        sku: normalizeSku(getValue(normalized, ["sku", "codigo", "cod_produto", "referencia"])),
        variantId: String(getValue(normalized, ["variant_id", "variantid", "id_variacao"]) || ""),
        productName: String(getValue(normalized, ["produto", "productname", "nome", "nome_produto"]) || ""),
        wholesalePrice: money(getValue(normalized, ["preco_atacado", "wholesaleprice", "preco", "valor_atacado"])),
        wholesaleStock: Number(getValue(normalized, ["estoque_atacado", "wholesalestock", "estoque", "saldo_atacado"]) || 0),
        enabled: true
      };
    })
    .filter((row) => row.sku);
}

export function parseSpreadsheet(buffer, filename) {
  throw new Error("Use parseSpreadsheetAsync.");
}

function parseCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const separator = lines[0]?.includes(";") ? ";" : ",";
  const headers = lines.shift()?.split(separator).map((header) => header.trim()) || [];

  return lines.map((line) => {
    const values = line.split(separator).map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

export async function parseSpreadsheetAsync(buffer, filename) {
  const extension = String(filename || "").toLowerCase().split(".").pop();
  let rows = [];

  if (extension === "csv") {
    rows = parseCsv(buffer);
  } else if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    const headers = [];

    sheet.getRow(1).eachCell((cell, columnNumber) => {
      headers[columnNumber] = String(cell.value || "");
    });

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item = {};
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        item[headers[columnNumber]] = cell.value?.text || cell.value || "";
      });
      rows.push(item);
    });
  } else {
    throw new Error("Formato nao suportado. Use CSV ou XLSX.");
  }

  return normalizeRows(rows);
}
