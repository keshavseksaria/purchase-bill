import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractBillData } from '@/lib/gemini';

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

// This route handles the heavy lifting in the background
export async function POST(request, { params }) {
  const { id: entryId } = await params;

  try {
    // 1. Fetch the entry to get the image URL
    const { data: entry, error: fetchErr } = await supabase
      .from('entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (fetchErr || !entry) {
      console.error('Background processing: Entry not found', entryId);
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // 2. Download the image from storage to send to Gemini
    // Extract file name from URL (assuming public URL format)
    const urlParts = entry.image_url.split('/');
    const fileName = urlParts[urlParts.length - 1];

    const { data: imageBlob, error: downloadErr } = await supabase.storage
      .from('bill-images')
      .download(fileName);

    if (downloadErr) throw downloadErr;

    const buffer = await imageBlob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imageBlob.type || 'image/jpeg';

    // 3. Fetch Master Data for mapping
    const [ledgersData, stockItemsData] = await Promise.all([
      fetchAllRows('ledgers'),
      fetchAllRows('stock_items')
    ]);

    const masterData = {
      ledgers: ledgersData || [],
      stockItems: stockItemsData || [],
    };

    // 4. Run Gemini Extraction
    let extracted;
    try {
      extracted = await extractBillData(base64, masterData, mimeType);
    } catch (aiErr) {
      await supabase.from('entries').update({
        status: 'failed',
        error_message: aiErr.message
      }).eq('id', entryId);
      throw aiErr;
    }

    // 5. Update Entry
    const entryUpdate = {
      status: 'pending', // Keep as pending for user review, or set to 'processed' if you prefer
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
      error_message: null,
    };

    await supabase.from('entries').update(entryUpdate).eq('id', entryId);

    // 6. Insert Items
    if (extracted.items && extracted.items.length > 0) {
      const items = extracted.items.map((item, idx) => ({
        id: crypto.randomUUID(),
        entry_id: entryId,
        bill_item_name: item.bill_item_name || '', // This stores the printed name
        name_of_item: item.name_of_item || item.handwritten_name_raw || '', // Primary name is the mapped stock item or handwritten code
        batch_no: item.batch_no || '',
        actual_qty: item.actual_qty || 0,
        billed_qty: item.billed_qty || item.actual_qty || 0,
        rate: item.rate || 0,
        amount: item.amount || 0,
        discount: 0,
        unit: item.unit || 'No.',
        sort_order: idx,
      }));

      await supabase.from('entry_items').insert(items);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`Background processing error for ${entryId}:`, err);
    // Update entry with error
    await supabase.from('entries').update({
      status: 'failed',
      error_message: err.message
    }).eq('id', entryId);
    
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
