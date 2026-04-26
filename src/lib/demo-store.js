/**
 * In-memory store for demo mode (when Supabase is not configured).
 * Data lives only in the server process memory.
 */

let entries = [];
let entryItems = [];
let ledgers = [];
let stockItems = [];

export const demoStore = {
  // ─── Entries ───
  getEntries(status) {
    let result = [...entries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (status && status !== 'all') result = result.filter(e => e.status === status);
    return result;
  },

  getEntry(id) {
    return entries.find(e => e.id === id) || null;
  },

  createEntry(data) {
    const entry = {
      id: data.id || crypto.randomUUID(),
      status: 'pending',
      image_url: data.image_url || '',
      date: data.date || null,
      supplier_invoice_no: data.supplier_invoice_no || '',
      supplier_invoice_date: data.supplier_invoice_date || null,
      party_name: data.party_name || '',
      party_name_raw: data.party_name_raw || '',
      cgst: data.cgst || 0,
      sgst: data.sgst || 0,
      igst: data.igst || 0,
      round_off: data.round_off || 0,
      total: data.total || 0,
      ai_confidence: data.ai_confidence || null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    entries.push(entry);
    return entry;
  },

  updateEntry(id, data) {
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...data, updated_at: new Date().toISOString() };
    return entries[idx];
  },

  deleteEntry(id) {
    entries = entries.filter(e => e.id !== id);
    entryItems = entryItems.filter(i => i.entry_id !== id);
  },

  // ─── Entry Items ───
  getEntryItems(entryId) {
    return entryItems
      .filter(i => i.entry_id === entryId)
      .sort((a, b) => a.sort_order - b.sort_order);
  },

  setEntryItems(entryId, items) {
    entryItems = entryItems.filter(i => i.entry_id !== entryId);
    items.forEach((item, idx) => {
      entryItems.push({
        id: item.id || crypto.randomUUID(),
        entry_id: entryId,
        bill_item_name: item.bill_item_name || '',
        name_of_item: item.name_of_item || '',
        batch_no: item.batch_no || '',
        actual_qty: item.actual_qty || 0,
        billed_qty: item.billed_qty || 0,
        rate: item.rate || 0,
        amount: item.amount || 0,
        discount: item.discount || 0,
        unit: item.unit || 'No.',
        sort_order: idx,
        created_at: item.created_at || new Date().toISOString(),
      });
    });
  },

  // ─── Master Data ───
  getLedgers() { return [...ledgers]; },
  getStockItems() { return [...stockItems]; },

  setLedgers(data) { ledgers = data; },
  setStockItems(data) { stockItems = data; },

  // ─── Bridge ───
  getApprovedEntries() {
    return entries.filter(e => e.status === 'approved');
  },
};
