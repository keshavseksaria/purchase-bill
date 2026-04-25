/**
 * Tally Bridge — Runs on Windows laptop alongside Tally.
 *
 * 1. Polls cloud app for approved entries
 * 2. Sends XML to Tally localhost:9000
 * 3. Reports success/failure back to cloud
 * 4. Syncs master data (ledgers, stock items) from Tally to cloud
 * 5. Local dashboard at http://localhost:3456
 *
 * Usage: node index.js
 *
 * Environment:
 *   CLOUD_URL       — Your deployed BillSync URL (e.g., https://your-app.vercel.app)
 *   TALLY_HOST      — Tally server host (default: http://localhost:9000)
 *   POLL_INTERVAL   — Seconds between polls (default: 10)
 *   SYNC_INTERVAL   — Minutes between master data syncs (default: 30)
 *   DASHBOARD_PORT  — Local dashboard port (default: 3456)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const CLOUD_URL = process.env.CLOUD_URL || 'http://localhost:3000';
const TALLY_HOST = process.env.TALLY_HOST || 'http://localhost:9000';
const POLL_INTERVAL = (parseInt(process.env.POLL_INTERVAL) || 10) * 1000;
const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL) || 30) * 60 * 1000;
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT) || 3456;

// ─── State Management ───

const state = {
    tallyConnected: false,
    cloudConnected: false,
    masterData: { ledgerCount: 0, stockItemCount: 0, lastSync: null },
    stats: { totalSynced: 0, totalFailed: 0 },
    logs: [],
    config: {
        cloudUrl: CLOUD_URL,
        tallyHost: TALLY_HOST,
        pollIntervalSec: POLL_INTERVAL / 1000,
        syncIntervalMin: SYNC_INTERVAL / 60000,
    },
    startedAt: new Date().toISOString(),
};

function addLog(type, message) {
    state.logs.unshift({ timestamp: new Date().toISOString(), type, message });
    if (state.logs.length > 500) state.logs.length = 500;
    const icons = { info: '🔄', success: '✅', error: '❌', warning: '⚠️' };
    console.log(`  ${icons[type] || '•'} ${message}`);
}

// ─── Tally Communication ───

async function sendToTally(xml) {
    const res = await fetch(TALLY_HOST, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: xml,
    });
    state.tallyConnected = true;

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
    try {
        const res = await fetch(TALLY_HOST, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: xml,
        });
        state.tallyConnected = true;
        return await res.text();
    } catch (err) {
        state.tallyConnected = false;
        throw err;
    }
}

// ─── Master Data Sync ───

const LEDGER_REQUEST = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;

const STOCK_ITEM_REQUEST = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Stock Items</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
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
    addLog('info', 'Syncing master data from Tally...');
    try {
        // Fetch ledgers
        const ledgerXml = await fetchFromTally(LEDGER_REQUEST);
        const ledgers = parseNames(ledgerXml, 'LEDGER');
        state.masterData.ledgerCount = ledgers.length;
        addLog('info', `Found ${ledgers.length} ledgers`);

        // Fetch stock items
        const stockXml = await fetchFromTally(STOCK_ITEM_REQUEST);
        const stockItems = parseNames(stockXml, 'STOCKITEM');
        state.masterData.stockItemCount = stockItems.length;
        addLog('info', `Found ${stockItems.length} stock items`);

        // Upload to cloud
        const res = await fetch(`${CLOUD_URL}/api/master-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ledgers, stockItems }),
        });

        if (!res.ok) throw new Error(`Cloud upload failed: ${res.status}`);
        state.cloudConnected = true;
        state.masterData.lastSync = new Date().toISOString();
        addLog('success', 'Master data synced to cloud');
    } catch (err) {
        if (err.message.includes('ECONNREFUSED') && err.message.includes('9000')) {
            state.tallyConnected = false;
            addLog('warning', 'Tally is not reachable — is it running?');
        } else if (err.message.includes('ECONNREFUSED')) {
            state.cloudConnected = false;
            addLog('error', 'Cloud app is not reachable');
        } else {
            addLog('error', `Master data sync failed: ${err.message}`);
        }
    }
}

// ─── Entry Processing ───

async function processApprovedEntries() {
    try {
        const res = await fetch(`${CLOUD_URL}/api/bridge/pending`);
        if (!res.ok) throw new Error(`Cloud fetch failed: ${res.status}`);

        state.cloudConnected = true;
        const entries = await res.json();
        if (!Array.isArray(entries) || entries.length === 0) return;

        addLog('info', `Found ${entries.length} approved entries to sync`);

        for (const { entry, xml } of entries) {
            addLog('info', `Processing: ${entry.party_name} — ${entry.supplier_invoice_no} — ₹${entry.total}`);

            try {
                const result = await sendToTally(xml);

                if (result.success) {
                    state.stats.totalSynced++;
                    addLog('success', `Pushed to Tally: ${entry.party_name} — ₹${entry.total}`);
                    await fetch(`${CLOUD_URL}/api/bridge/pending`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: entry.id, status: 'synced' }),
                    });
                } else {
                    state.stats.totalFailed++;
                    addLog('warning', `Tally response unclear for: ${entry.party_name}`);
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
                state.stats.totalFailed++;
                addLog('error', `Failed: ${entry.party_name} — ${err.message}`);
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
        if (err.message.includes('ECONNREFUSED')) {
            state.cloudConnected = false;
        } else {
            addLog('error', `Poll error: ${err.message}`);
        }
    }
}

// ─── Dashboard Server ───

function startDashboard() {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/') {
            try {
                const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } catch {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Dashboard HTML not found');
            }
            return;
        }

        if (req.method === 'GET' && req.url === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(state));
            return;
        }

        if (req.method === 'POST' && req.url === '/api/sync-master') {
            await syncMasterData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        if (req.method === 'POST' && req.url === '/api/sync-entries') {
            await processApprovedEntries();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    });

    server.listen(DASHBOARD_PORT, () => {
        console.log(`  🌐 Dashboard: http://localhost:${DASHBOARD_PORT}\n`);
        addLog('success', `Dashboard started at http://localhost:${DASHBOARD_PORT}`);
    });
}

// ─── Main Loop ───

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       📄 BillSync Tally Bridge           ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Cloud:     ${CLOUD_URL.padEnd(27)}║`);
    console.log(`║  Tally:     ${TALLY_HOST.padEnd(27)}║`);
    console.log(`║  Poll:      Every ${POLL_INTERVAL / 1000}s${''.padEnd(20 - String(POLL_INTERVAL / 1000).length)}║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Start dashboard
    startDashboard();

    // Initial master data sync
    await syncMasterData();

    // Poll for approved entries
    addLog('info', 'Watching for approved entries...');
    setInterval(processApprovedEntries, POLL_INTERVAL);

    // Periodic master data sync
    setInterval(syncMasterData, SYNC_INTERVAL);
}

main().catch(console.error);
