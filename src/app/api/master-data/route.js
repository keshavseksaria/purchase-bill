import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';

// Helper to fetch all rows bypassing 1000 row limit
async function fetchAllRows(tableName) {
  let allData = [];
  let start = 0;
  const limit = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('name')
      .range(start, start + limit - 1);
      
    if (error) throw error;
    allData = allData.concat(data);
    
    if (data.length < limit) break;
    start += limit;
  }
  
  return allData;
}

// GET /api/master-data
export async function GET() {
  try {
    if (isDemoMode) {
      return NextResponse.json({
        ledgers: demoStore.getLedgers(),
        stockItems: demoStore.getStockItems(),
      });
    }

    const ledgers = await fetchAllRows('ledgers');
    const stockItems = await fetchAllRows('stock_items');

    return NextResponse.json({
      ledgers: ledgers || [],
      stockItems: stockItems || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/master-data — used by Tally Bridge to upload master data
export async function POST(request) {
  try {
    const body = await request.json();
    const { ledgers, stockItems } = body;

    if (isDemoMode) {
      if (ledgers) demoStore.setLedgers(ledgers);
      if (stockItems) demoStore.setStockItems(stockItems);
      return NextResponse.json({ success: true });
    }

    // Upsert ledgers
    if (ledgers && ledgers.length > 0) {
      await supabase.from('ledgers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      const { error } = await supabase.from('ledgers').insert(ledgers);
      if (error) throw error;
    }

    // Upsert stock items
    if (stockItems && stockItems.length > 0) {
      await supabase.from('stock_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      const { error } = await supabase.from('stock_items').insert(stockItems);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
