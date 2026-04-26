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

    // Store image as data URL (simple, no Storage bucket needed)
    let imageUrl = `data:${mimeType};base64,${base64}`;
    const entryId = crypto.randomUUID();

    // Extract data from bill using Gemini
    let extracted;
    try {
      extracted = await extractBillData(base64, mimeType);
    } catch (aiErr) {
      console.error('AI extraction failed:', aiErr);
      extracted = {
        date: null,
        supplier_invoice_no: 'EXTRACTION_FAILED',
        supplier_invoice_date: null,
        party_name: null,
        error_message: aiErr.message, // Save error to database
        items: [],
        cgst: 0, sgst: 0, igst: 0, round_off: 0, total: 0,
      };
    }

    // Fetch master data for auto-mapping
    const [ledgersRes, stockItemsRes] = await Promise.all([
      supabase.from('ledgers').select('name'),
      supabase.from('stock_items').select('name'),
    ]);
    const ledgers = ledgersRes.data || [];
    const stockItemsMaster = stockItemsRes.data || [];

    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Auto-map Party Name
    const aiPartyName = extracted.party_name || '';
    const mappedParty = ledgers.find(l => normalize(l.name) === normalize(aiPartyName))?.name || null;

    // Create entry
    const entryData = {
      id: entryId,
      image_url: imageUrl,
      date: extracted.date || null,
      supplier_invoice_no: extracted.supplier_invoice_no || null,
      supplier_invoice_date: extracted.supplier_invoice_date || null,
      party_name: mappedParty, // Use the fuzzy mapped name!
      party_name_raw: aiPartyName,
      cgst: extracted.cgst || 0,
      sgst: extracted.sgst || 0,
      igst: extracted.igst || 0,
      round_off: extracted.round_off || 0,
      total: extracted.total || 0,
      error_message: extracted.error_message || null,
    };

    const items = (extracted.items || []).map((item, idx) => {
      const aiItemName = item.bill_item_name || '';
      const mappedItem = stockItemsMaster.find(s => normalize(s.name) === normalize(aiItemName))?.name || null;
      
      return {
        id: crypto.randomUUID(),
        entry_id: entryId,
        bill_item_name: aiItemName,
        name_of_item: mappedItem, // Use the fuzzy mapped name!
        batch_no: item.batch_no || '',
        actual_qty: item.actual_qty || 0,
        billed_qty: item.billed_qty || item.actual_qty || 0,
        rate: item.rate || 0,
        amount: item.amount || 0,
        unit: item.unit || 'No.',
        sort_order: idx,
      };
    });

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
