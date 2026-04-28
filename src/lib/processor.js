import { supabase } from './supabase';
import { extractBillData } from './gemini';

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

export async function processBill(entryId) {
  try {
    console.log(`[Processor] Starting ${entryId}`);
    
    // 1. Fetch the entry to get the image URL
    const { data: entry, error: fetchErr } = await supabase
      .from('entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (fetchErr || !entry) {
      throw new Error('Entry not found');
    }

    // 2. Download the image from storage
    const urlParts = entry.image_url.split('/');
    const fileName = urlParts[urlParts.length - 1];

    const { data: imageBlob, error: downloadErr } = await supabase.storage
      .from('bill-images')
      .download(fileName);

    if (downloadErr) throw downloadErr;

    const buffer = await imageBlob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imageBlob.type || 'image/jpeg';

    // 3. Fetch Master Data
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
        error_message: `AI Error: ${aiErr.message}`
      }).eq('id', entryId);
      throw aiErr;
    }

    // 5. Update Entry
    const entryUpdate = {
      status: 'pending',
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

    // 6. Clear old items (for retries)
    await supabase.from('entry_items').delete().eq('entry_id', entryId);

    // 7. Insert Items
    if (extracted.items && extracted.items.length > 0) {
      const items = extracted.items.map((item, idx) => ({
        id: crypto.randomUUID(),
        entry_id: entryId,
        bill_item_name: item.bill_item_name || '', 
        name_of_item: item.name_of_item || item.handwritten_name_raw || '', 
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

    console.log(`[Processor] Completed ${entryId}`);
    return { success: true };
  } catch (err) {
    console.error(`[Processor] Error for ${entryId}:`, err);
    await supabase.from('entries').update({
      status: 'failed',
      error_message: err.message
    }).eq('id', entryId);
    throw err;
  }
}
