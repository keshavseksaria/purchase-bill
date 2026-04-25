import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';

// GET /api/master-data
export async function GET() {
  try {
    if (isDemoMode) {
      return NextResponse.json({
        ledgers: demoStore.getLedgers(),
        stockItems: demoStore.getStockItems(),
      });
    }

    const { data: ledgers } = await supabase.from('ledgers').select('*').order('name');
    const { data: stockItems } = await supabase.from('stock_items').select('*').order('name');

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
