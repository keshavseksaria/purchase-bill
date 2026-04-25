/**
 * Tally Bridge — Runs on Windows laptop alongside Tally.
 *
 * 1. Polls cloud app for approved entries
 * 2. Sends XML to Tally localhost:9000
 * 3. Reports success/failure back to cloud
 * 4. Syncs master data (ledgers, stock items) from Tally to cloud
 *
 * Usage: node index.js
 *
 * Environment:
 *   CLOUD_URL     — Your deployed BillSync URL (e.g., https://your-app.vercel.app)
 *   TALLY_HOST    — Tally server host (default: http://localhost:9000)
 *   POLL_INTERVAL — Seconds between polls (default: 10)
 *   SYNC_INTERVAL — Minutes between master data syncs (default: 30)
 */

const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const CLOUD_URL = process.env.CLOUD_URL || 'http://localhost:3000';
const TALLY_HOST = process.env.TALLY_HOST || 'http://localhost:9000';
const POLL_INTERVAL = (parseInt(process.env.POLL_INTERVAL) || 10) * 1000;
const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL) || 30) * 60 * 1000;

// ─── Tally Communication ───

async function sendToTally(xml) {
  const res = await fetch(TALLY_HOST, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  });

  const responseText = await res.text();

  // Check for errors in Tally response
  if (responseText.includes('<LINEERROR>') || responseText.includes('<ERRORS>')) {
    const errorMatch = responseText.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
    throw new Error(errorMatch ? errorMatch[1] : 'Tally import error — check Tally for details');
  }

  // Check for success
  if (responseText.includes('<CREATED>1</CREATED>') || responseText.includes('<CREATED> 1</CREATED>')) {
    return { success: true, response: responseText };
  }

  // Check if there were 0 errors (also success)
  if (responseText.includes('<ERRORS>0</ERRORS>') || responseText.includes('<ERRORS> 0</ERRORS>')) {
    return { success: true, response: responseText };
  }

  return { success: false, response: responseText };
}

async function fetchFromTally(xml) {
  const res = await fetch(TALLY_HOST, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  });
  return await res.text();
}

// ─── Master Data Sync ───

const LEDGER_REQUEST = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export</TALLYREQUEST></HEADER>
 <BODY>
  <EXPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>List of Ledgers</REPORTNAME>
    <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;

const STOCK_ITEM_REQUEST = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export</TALLYREQUEST></HEADER>
 <BODY>
  <EXPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>List of Stock Items</REPORTNAME>
    <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;

function parseNames(xml, tagName) {
  const names = [];
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const nameMatch = match[1].match(/<NAME>(.*?)<\/NAME>/i);
    const parentMatch = match[1].match(/<PARENT>(.*?)<\/PARENT>/i);
    const unitMatch = match[1].match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i);
    if (nameMatch) {
      names.push({
        name: nameMatch[1].trim(),
        parent_group: parentMatch ? parentMatch[1].trim() : '',
        unit: unitMatch ? unitMatch[1].trim() : '',
      });
    }
  }
  return names;
}

async function syncMasterData() {
  console.log('🔄 Syncing master data from Tally...');
  try {
    // Fetch ledgers
    const ledgerXml = await fetchFromTally(LEDGER_REQUEST);
    const ledgers = parseNames(ledgerXml, 'LEDGER');
    console.log(`  📒 Found ${ledgers.length} ledgers`);

    // Fetch stock items
    const stockXml = await fetchFromTally(STOCK_ITEM_REQUEST);
    const stockItems = parseNames(stockXml, 'STOCKITEM');
    console.log(`  📦 Found ${stockItems.length} stock items`);

    // Upload to cloud
    const res = await fetch(`${CLOUD_URL}/api/master-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ledgers, stockItems }),
    });

    if (!res.ok) throw new Error(`Cloud upload failed: ${res.status}`);
    console.log('  ✅ Master data synced to cloud');
  } catch (err) {
    console.error('  ❌ Master data sync failed:', err.message);
  }
}

// ─── Entry Processing ───

async function processApprovedEntries() {
  try {
    const res = await fetch(`${CLOUD_URL}/api/bridge/pending`);
    if (!res.ok) throw new Error(`Cloud fetch failed: ${res.status}`);

    const entries = await res.json();
    if (!Array.isArray(entries) || entries.length === 0) return;

    console.log(`\n📬 Found ${entries.length} approved entries to sync`);

    for (const { entry, xml } of entries) {
      console.log(`\n  Processing: ${entry.party_name} — ${entry.supplier_invoice_no} — ₹${entry.total}`);

      try {
        const result = await sendToTally(xml);

        if (result.success) {
          console.log('  ✅ Successfully pushed to Tally!');
          await fetch(`${CLOUD_URL}/api/bridge/pending`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: entry.id, status: 'synced' }),
          });
        } else {
          console.log('  ⚠️  Tally response unclear, marking as failed');
          await fetch(`${CLOUD_URL}/api/bridge/pending`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: entry.id,
              status: 'failed',
              error_message: 'Tally response did not confirm success',
            }),
          });
        }
      } catch (err) {
        console.error(`  ❌ Failed: ${err.message}`);
        await fetch(`${CLOUD_URL}/api/bridge/pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: entry.id,
            status: 'failed',
            error_message: err.message,
          }),
        });
      }
    }
  } catch (err) {
    // Don't spam errors for routine network issues
    if (err.message.includes('ECONNREFUSED')) {
      // Cloud is down, silently wait
    } else {
      console.error('Poll error:', err.message);
    }
  }
}

// ─── Main Loop ───

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║       📄 BillSync Tally Bridge       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Cloud:  ${CLOUD_URL.padEnd(27)}║`);
  console.log(`║  Tally:  ${TALLY_HOST.padEnd(27)}║`);
  console.log(`║  Poll:   Every ${POLL_INTERVAL / 1000}s${''.padEnd(20 - String(POLL_INTERVAL / 1000).length)}║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // Initial master data sync
  try {
    await syncMasterData();
  } catch (err) {
    console.log('⚠️  Initial master data sync failed (Tally may not be running yet)');
  }

  // Poll for approved entries
  console.log('👀 Watching for approved entries...');
  setInterval(processApprovedEntries, POLL_INTERVAL);

  // Periodic master data sync
  setInterval(syncMasterData, SYNC_INTERVAL);
}

main().catch(console.error);
