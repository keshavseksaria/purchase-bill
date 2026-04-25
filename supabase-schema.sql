-- Run this in the Supabase SQL Editor to set up the database.

-- Master data synced from Tally
CREATE TABLE IF NOT EXISTS ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_group TEXT,
    unit TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_group TEXT,
    unit TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase entries
CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'pending',
    image_url TEXT NOT NULL,

    date DATE,
    supplier_invoice_no TEXT,
    supplier_invoice_date DATE,
    party_name TEXT,
    party_name_raw TEXT,

    cgst DECIMAL(10,2) DEFAULT 0,
    sgst DECIMAL(10,2) DEFAULT 0,
    igst DECIMAL(10,2) DEFAULT 0,
    round_off DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(12,2) DEFAULT 0,

    ai_confidence JSONB,
    error_message TEXT,
    uploaded_by TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Line items
CREATE TABLE IF NOT EXISTS entry_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,

    bill_item_name TEXT,
    name_of_item TEXT,
    batch_no TEXT,
    actual_qty DECIMAL(10,3) DEFAULT 0,
    billed_qty DECIMAL(10,3) DEFAULT 0,
    rate DECIMAL(10,2) DEFAULT 0,
    amount DECIMAL(12,2) DEFAULT 0,
    unit TEXT DEFAULT 'No.',

    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create storage bucket for bill images
-- (Run this via Supabase Dashboard > Storage > Create Bucket)
-- Name: bill-images
-- Public: Yes

-- Enable RLS but allow all operations (simple setup)
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on entries" ON entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on entry_items" ON entry_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ledgers" ON ledgers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stock_items" ON stock_items FOR ALL USING (true) WITH CHECK (true);

-- ⚠️ IMPORTANT: Storage policies (needed for file uploads)
-- Create the bucket first via Dashboard, then run these:
INSERT INTO storage.buckets (id, name, public)
VALUES ('bill-images', 'bill-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public read on bill-images"
ON storage.objects FOR SELECT
USING (bucket_id = 'bill-images');

CREATE POLICY "Allow anon upload to bill-images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'bill-images');

CREATE POLICY "Allow anon update on bill-images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'bill-images');

CREATE POLICY "Allow anon delete on bill-images"
ON storage.objects FOR DELETE
USING (bucket_id = 'bill-images');
