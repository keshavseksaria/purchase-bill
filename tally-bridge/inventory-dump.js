#!/usr/bin/env node
/**
 * Inventory Dump — Extracts batch-wise stock inventory from Tally to Excel.
 *
 * Runs locally on the Windows machine alongside Tally.
 * Talks to Tally on localhost:9000, generates an Excel file for physical stock checking.
 *
 * Usage:
 *   node inventory-dump.js                              # All items
 *   node inventory-dump.js --item "SHKR"                # Filter by item name (contains)
 *   node inventory-dump.js --group "SHUTTING"            # Filter by stock group (contains)
 *   node inventory-dump.js --remnant-threshold 1.0       # Remnant cutoff in base unit (default: 1)
 *   node inventory-dump.js --output "my_stock.xlsx"      # Custom output filename
 *   node inventory-dump.js --tally "http://localhost:9000"  # Custom Tally host
 *
 * Dependencies: npm install exceljs
 */

const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// ─── CLI Args ───

const args = process.argv.slice(2);

function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`
  📦 Inventory Dump — Tally → Excel

  Usage:
    node inventory-dump.js [options]

  Options:
    --item <name>              Filter by item name (case-insensitive, contains match)
    --group <name>             Filter by stock group (case-insensitive, contains match)
    --remnant-threshold <n>    Qty threshold below which items are "remnants" (default: 1)
    --output <filename>        Output Excel filename (default: inventory_YYYY-MM-DD.xlsx)
    --tally <url>              Tally host URL (default: http://localhost:9000)
    --debug                    Save raw XML response to debug_response.xml
    --help                     Show this help
  `);
  process.exit(0);
}

const TALLY_HOST = getFlag('tally', 'http://localhost:9000');
const ITEM_FILTER = getFlag('item', null);
const GROUP_FILTER = getFlag('group', null);
const REMNANT_THRESHOLD = parseFloat(getFlag('remnant-threshold', '1'));
const OUTPUT_FILE = getFlag('output', `inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
const DEBUG = hasFlag('debug');

// ─── Tally Communication ───

/**
 * POST XML to Tally and return the response body as a string.
 */
function postToTally(xmlBody) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(TALLY_HOST);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 9000),
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(xmlBody),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', (err) => reject(err));
    req.write(xmlBody);
    req.end();
  });
}

// ─── TDL XML Queries ───

/**
 * TDL query to get batch-wise closing balances for all stock items.
 * Uses Tally's "Batch" collection which gives one record per (StockItem, Batch, Godown) combo.
 */
const BATCH_STOCK_QUERY = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>DATA</TYPE>
  <ID>InvBatchReport</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <REPORT NAME="InvBatchReport">
      <FORMS>InvBatchForm</FORMS>
     </REPORT>
     <FORM NAME="InvBatchForm">
      <PARTS>InvBatchPart</PARTS>
     </FORM>
     <PART NAME="InvBatchPart">
      <LINES>InvBatchLine</LINES>
      <REPEAT>InvBatchLine : InvBatchColl</REPEAT>
      <SCROLLED>Vertical</SCROLLED>
     </PART>
     <LINE NAME="InvBatchLine">
      <FIELDS>FldItemName,FldItemGroup,FldUnit,FldBatch,FldGodown,FldClQty,FldClRate,FldClVal</FIELDS>
      <XMLTAG>"ROW"</XMLTAG>
     </LINE>
     <FIELD NAME="FldItemName">
      <SET>$StockItemName</SET>
      <XMLTAG>"ITEMNAME"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldItemGroup">
      <SET>$Parent:StockItem:$StockItemName</SET>
      <XMLTAG>"ITEMGROUP"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldUnit">
      <SET>$BaseUnits:StockItem:$StockItemName</SET>
      <XMLTAG>"UNIT"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldBatch">
      <SET>$Name</SET>
      <XMLTAG>"BATCH"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldGodown">
      <SET>$GodownName</SET>
      <XMLTAG>"GODOWN"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldClQty">
      <SET>$$Number:$ClosingBalance</SET>
      <XMLTAG>"CLQTY"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldClRate">
      <SET>$$Number:$ClosingRate</SET>
      <XMLTAG>"CLRATE"</XMLTAG>
     </FIELD>
     <FIELD NAME="FldClVal">
      <SET>$$Number:$ClosingValue</SET>
      <XMLTAG>"CLVAL"</XMLTAG>
     </FIELD>
     <COLLECTION NAME="InvBatchColl">
      <TYPE>Batch</TYPE>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;

// ─── XML Parsing ───

/**
 * Extract text content of a tag from an XML fragment.
 * Returns empty string if tag not found.
 */
function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parse a Tally quantity string into a number.
 * Handles formats like: "24.00", "24.00 Mtr", "-10.50 Mtr", empty strings.
 */
function parseQty(raw) {
  if (!raw) return 0;
  // Strip everything that's not a digit, dot, or minus sign
  const cleaned = raw.replace(/[^\d.\-]/g, '').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Parse the Tally XML response into an array of stock records.
 */
function parseStockData(xml) {
  const records = [];

  // Find all <ROW>...</ROW> blocks
  const rowRegex = /<ROW>([\s\S]*?)<\/ROW>/gi;
  let match;

  while ((match = rowRegex.exec(xml)) !== null) {
    const block = match[1];

    const record = {
      itemName: extractTag(block, 'ITEMNAME'),
      itemGroup: extractTag(block, 'ITEMGROUP'),
      unit: extractTag(block, 'UNIT'),
      batch: extractTag(block, 'BATCH'),
      godown: extractTag(block, 'GODOWN'),
      qty: parseQty(extractTag(block, 'CLQTY')),
      rate: parseQty(extractTag(block, 'CLRATE')),
      value: parseQty(extractTag(block, 'CLVAL')),
    };

    // Skip completely empty rows
    if (!record.itemName && !record.batch) continue;

    records.push(record);
  }

  return records;
}

// ─── Filtering ───

/**
 * Apply CLI filters and categorize records into active, negative, and remnants.
 */
function filterAndCategorize(records) {
  let filtered = records;

  // Apply item name filter (case-insensitive contains)
  if (ITEM_FILTER) {
    const f = ITEM_FILTER.toLowerCase();
    filtered = filtered.filter((r) => r.itemName.toLowerCase().includes(f));
  }

  // Apply group filter (case-insensitive contains)
  if (GROUP_FILTER) {
    const f = GROUP_FILTER.toLowerCase();
    filtered = filtered.filter((r) => r.itemGroup.toLowerCase().includes(f));
  }

  const active = [];
  const negative = [];
  const remnants = [];
  let zeroCount = 0;

  for (const r of filtered) {
    if (r.qty === 0) {
      zeroCount++;
      continue; // Skip zero-balance items entirely
    }

    if (r.qty < 0) {
      negative.push(r);
    } else if (r.qty > 0 && r.qty <= REMNANT_THRESHOLD) {
      remnants.push(r);
    } else {
      active.push(r);
    }
  }

  // Sort: Item Name → Batch
  const sortFn = (a, b) => {
    const nameCompare = a.itemName.localeCompare(b.itemName);
    if (nameCompare !== 0) return nameCompare;
    return a.batch.localeCompare(b.batch);
  };

  active.sort(sortFn);
  negative.sort(sortFn);
  remnants.sort(sortFn);

  return { active, negative, remnants, zeroCount, totalFiltered: filtered.length };
}

// ─── Excel Generation ───

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const NEGATIVE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
const REMNANT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
const ALT_ROW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };

/**
 * Add a stock data sheet to the workbook.
 */
function addStockSheet(workbook, sheetName, records, options = {}) {
  const ws = workbook.addWorksheet(sheetName);

  // Columns
  const columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'Item Name', key: 'itemName', width: 25 },
    { header: 'Stock Group', key: 'itemGroup', width: 20 },
    { header: 'Batch', key: 'batch', width: 18 },
    { header: 'Godown', key: 'godown', width: 16 },
    { header: 'Tally Qty', key: 'qty', width: 12 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Value (₹)', key: 'value', width: 14 },
  ];

  // Add Physical Qty + Difference columns for active stock sheet
  if (options.includePhysical) {
    columns.push(
      { header: 'Physical Qty', key: 'physicalQty', width: 14 },
      { header: 'Difference', key: 'difference', width: 12 },
      { header: 'Notes', key: 'notes', width: 25 }
    );
  }

  ws.columns = columns;

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
    };
  });
  headerRow.height = 22;

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Add data rows
  records.forEach((r, i) => {
    const rowNum = i + 2; // 1-indexed, row 1 is header
    const row = ws.addRow({
      idx: i + 1,
      itemName: r.itemName,
      itemGroup: r.itemGroup,
      batch: r.batch,
      godown: r.godown,
      qty: r.qty,
      unit: r.unit,
      rate: r.rate,
      value: r.value,
    });

    // Number formatting
    row.getCell('qty').numFmt = '#,##0.00';
    row.getCell('rate').numFmt = '#,##0.00';
    row.getCell('value').numFmt = '₹#,##0.00';

    // Alternating row colors
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        if (!cell.fill || cell.fill.type !== 'pattern') {
          cell.fill = ALT_ROW_FILL;
        }
      });
    }

    // Add formulas for Physical Qty / Difference columns
    if (options.includePhysical) {
      const physCell = row.getCell('physicalQty');
      physCell.numFmt = '#,##0.00';
      // Leave blank for user to fill in

      const diffCell = row.getCell('difference');
      // Formula: Physical Qty - Tally Qty (column J - column F)
      diffCell.value = { formula: `IF(J${rowNum}="","",J${rowNum}-F${rowNum})` };
      diffCell.numFmt = '#,##0.00';
    }

    // Apply background for negative / remnant sheets
    if (options.rowFill) {
      row.eachCell((cell) => {
        cell.fill = options.rowFill;
      });
    }
  });

  // Auto-filter
  if (records.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: records.length + 1, column: columns.length },
    };
  }

  // Summary row at the bottom
  if (records.length > 0) {
    const summaryRowNum = records.length + 3;
    const summaryRow = ws.getRow(summaryRowNum);
    summaryRow.getCell(1).value = '';
    summaryRow.getCell(2).value = 'TOTAL';
    summaryRow.getCell(2).font = { bold: true };
    summaryRow.getCell(5).value = `${records.length} batches`;
    summaryRow.getCell(5).font = { bold: true };
    // Sum of values
    summaryRow.getCell(9).value = { formula: `SUM(I2:I${records.length + 1})` };
    summaryRow.getCell(9).numFmt = '₹#,##0.00';
    summaryRow.getCell(9).font = { bold: true };
  }

  return ws;
}

async function generateExcel(categorized, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BillSync Inventory Dump';
  workbook.created = new Date();

  // Sheet 1: Active Stock (main checking list)
  addStockSheet(workbook, '📋 Active Stock', categorized.active, {
    includePhysical: true,
  });

  // Sheet 2: Negative Inventory
  if (categorized.negative.length > 0) {
    addStockSheet(workbook, '⚠️ Negative', categorized.negative, {
      rowFill: NEGATIVE_FILL,
    });
  }

  // Sheet 3: Remnants
  if (categorized.remnants.length > 0) {
    addStockSheet(workbook, '🔸 Remnants', categorized.remnants, {
      rowFill: REMNANT_FILL,
    });
  }

  await workbook.xlsx.writeFile(outputPath);
}

// ─── Main ───

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   📦 Inventory Dump — Tally → Excel          ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Tally:     ${TALLY_HOST.padEnd(32)}║`);
  if (ITEM_FILTER) console.log(`║  Item:      ${ITEM_FILTER.padEnd(32)}║`);
  if (GROUP_FILTER) console.log(`║  Group:     ${GROUP_FILTER.padEnd(32)}║`);
  console.log(`║  Remnant:   ≤ ${REMNANT_THRESHOLD} (base unit)${''.padEnd(22 - String(REMNANT_THRESHOLD).length)}║`);
  console.log(`║  Output:    ${OUTPUT_FILE.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Fetch from Tally
  console.log('  🔄 Connecting to Tally...');
  let responseXml;
  try {
    responseXml = await postToTally(BATCH_STOCK_QUERY);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('  ❌ Cannot connect to Tally. Is Tally running on ' + TALLY_HOST + '?');
      process.exit(1);
    }
    throw err;
  }
  console.log('  ✅ Connected to Tally');

  // Debug: save raw XML
  if (DEBUG) {
    fs.writeFileSync('debug_response.xml', responseXml);
    console.log('  🐛 Saved raw XML to debug_response.xml');
  }

  // Check for error in response
  if (responseXml.includes('<LINEERROR>') || responseXml.includes('<ERROR>')) {
    console.error('  ❌ Tally returned an error. Run with --debug to inspect the raw XML.');
    if (DEBUG) console.error('  Response:', responseXml.substring(0, 500));
    process.exit(1);
  }

  // Step 2: Parse
  console.log('  🔄 Parsing stock data...');
  const records = parseStockData(responseXml);

  if (records.length === 0) {
    console.log('');
    console.log('  ⚠️  No batch data found in Tally response.');
    console.log('      This could mean:');
    console.log('        • No stock items with batches exist');
    console.log('        • The TDL query needs adjustment for your Tally version');
    console.log('      Run with --debug to save the raw XML for inspection.');
    process.exit(1);
  }

  console.log(`  ✅ Found ${records.length} total batch records`);

  // Step 3: Filter & Categorize
  const categorized = filterAndCategorize(records);

  console.log('');
  console.log('  ┌─────────────────────────────────────┐');
  console.log(`  │  📋 Active Stock:    ${String(categorized.active.length).padStart(6)} batches  │`);
  console.log(`  │  ⚠️  Negative:        ${String(categorized.negative.length).padStart(6)} batches  │`);
  console.log(`  │  🔸 Remnants (≤${REMNANT_THRESHOLD}):  ${String(categorized.remnants.length).padStart(6)} batches  │`);
  console.log(`  │  ⊘  Zero balance:    ${String(categorized.zeroCount).padStart(6)} (skipped) │`);
  console.log('  └─────────────────────────────────────┘');
  console.log('');

  // Step 4: Generate Excel
  console.log('  🔄 Generating Excel...');
  const outputPath = path.resolve(OUTPUT_FILE);
  await generateExcel(categorized, outputPath);

  console.log(`  ✅ Done! Saved to: ${outputPath}`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open the Excel file');
  console.log('    2. Go to "📋 Active Stock" sheet');
  console.log('    3. Fill in "Physical Qty" column while checking stock');
  console.log('    4. "Difference" column auto-calculates mismatches');
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('  ❌ Fatal error:', err.message);
  if (DEBUG) console.error(err.stack);
  process.exit(1);
});
