import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';
import { extractBillData } from '@/lib/gemini';

export const maxDuration = 60; // Allow Vercel to run up to 60s for Gemini API

// GET /api/entries?status=pending
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';

  try {
    if (isDemoMode) {
      return NextResponse.json(demoStore.getEntries(status));
    }

    let query = supabase.from('entries').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Helper to fetch all rows bypassing 1000 row limit
async function fetchAllRows(tableName) {
  let allData = [];
  let start = 0;
  const limit = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('name')
      .range(start, start + limit - 1);
      
    if (error) throw error;
    allData = allData.concat(data);
    
    if (data.length < limit) break;
    start += limit;
  }
  
  return allData;
}

// POST /api/entries — upload a new bill
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Read file as base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';

    // Store image as data URL
    let imageUrl = `data:${mimeType};base64,${base64}`;
    const entryId = crypto.randomUUID();

    // Fetch master data for Gemini mapping (using pagination to get ALL rows)
    const ledgersData = await fetchAllRows('ledgers');
    const stockItemsData = await fetchAllRows('stock_items');
    
    const masterData = {
      ledgers: ledgersData || [],
      stockItems: stockItemsData || [],
    };

    // Extract data from bill using Gemini (passing master data for auto-mapping)
    let extracted;
    try {
      extracted = await extractBillData(base64, masterData, mimeType);
    } catch (aiErr) {
      console.error('AI extraction failed:', aiErr);
      extracted = {
        date: null,
        supplier_invoice_no: 'EXTRACTION_FAILED',
        supplier_invoice_date: null,
        party_name: null,
        error_message: aiErr.message,
        items: [],
        cgst: 0, sgst: 0, igst: 0, round_off: 0, total: 0,
      };
    }

    // Create entry
    const entryData = {
      id: entryId,
      image_url: imageUrl,
      date: extracted.date || null,
      supplier_invoice_no: extracted.supplier_invoice_no || null,
      supplier_invoice_date: extracted.supplier_invoice_date || null,
      party_name: extracted.party_name || null,
      party_name_raw: extracted.party_name_raw || extracted.party_name || null,
      cgst: extracted.cgst || 0,
      sgst: extracted.sgst || 0,
      igst: extracted.igst || 0,
      round_off: extracted.round_off || 0,
      total: extracted.total || 0,
      error_message: extracted.error_message || null,
    };

    const items = (extracted.items || []).map((item, idx) => ({
      id: crypto.randomUUID(),
      entry_id: entryId,
      bill_item_name: item.handwritten_name_raw || item.bill_item_name || '', // Use figured name as primary display
      name_of_item: item.name_of_item || '',
      batch_no: item.batch_no || '',
      actual_qty: item.actual_qty || 0,
      billed_qty: item.billed_qty || item.actual_qty || 0,
      rate: item.rate || 0,
      amount: item.amount || 0,
      discount: 0,
      unit: item.unit || 'No.',
      sort_order: idx,
    }));

    if (isDemoMode) {
      const entry = demoStore.createEntry(entryData);
      demoStore.setEntryItems(entryId, items);
      return NextResponse.json({ entry, items });
    }

    // Supabase insert
    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .insert(entryData)
      .select()
      .single();
    if (entryErr) throw entryErr;

    if (items.length > 0) {
      const { error: itemsErr } = await supabase
        .from('entry_items')
        .insert(items);
      if (itemsErr) throw itemsErr;
    }

    return NextResponse.json({ entry, items });
  } catch (err) {
    console.error('POST /api/entries error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
