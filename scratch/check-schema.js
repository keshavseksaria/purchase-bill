const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function checkSchema() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/entry_items?select=*&limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  if (data.length > 0) {
    console.log('Columns in entry_items:', Object.keys(data[0]));
  } else {
    console.log('Table is empty, checking OpenAPI schema...');
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        headers: { 'apikey': SUPABASE_KEY }
    });
    const schema = await res2.json();
    console.log('Columns in entry_items:', Object.keys(schema.definitions.entry_items.properties));
  }
}
checkSchema();
