import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';

export const maxDuration = 60;

// GET /api/entries?status=pending
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';

  try {
    if (isDemoMode) {
      return NextResponse.json(demoStore.getEntries(status));
    }

    let query = supabase
      .from('entries')
      .select('id, status, date, supplier_invoice_no, party_name, party_name_raw, total, image_url, created_at, error_message')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/entries — upload a new bill (upload only, processing triggered by client)
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (isDemoMode) {
      return NextResponse.json({ error: 'Upload not supported in demo mode' }, { status: 400 });
    }

    const entryId = crypto.randomUUID();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 1. Upload to Supabase Storage
    const fileName = `${entryId}-${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('bill-images')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('bill-images')
      .getPublicUrl(fileName);

    // 2. Create entry with 'pending' status
    const entryData = {
      id: entryId,
      image_url: publicUrl,
      status: 'pending',
      party_name: 'Processing...',
      total: 0
    };

    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .insert(entryData)
      .select()
      .single();

    if (entryErr) throw entryErr;

    // Processing is triggered by the client via POST /api/entries/[id]/process
    return NextResponse.json({ entry });
  } catch (err) {
    console.error('POST /api/entries error:', err);
    return NextResponse.json({
      error: err.message || 'Unknown upload error',
      details: err
    }, { status: 500 });
  }
}
