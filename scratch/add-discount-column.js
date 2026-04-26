const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function addColumn() {
  const sql = `ALTER TABLE entry_items ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/run_sql`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({ sql })
  });
  if (res.ok) {
    console.log('Discount column added successfully');
  } else {
    const err = await res.text();
    console.error('Failed to add column (possibly no RPC access):', err);
    console.log('I will assume it might already exist or I can skip and just use it in the UI object for now.');
  }
}
addColumn();
