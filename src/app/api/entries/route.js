import { NextResponse, waitUntil } from 'next/server';
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

    // Optimization: Do NOT select the full image_url if it might contain Base64
    // However, the frontend needs the thumbnail. 
    // For now, we select needed fields. image_url is still needed for the thumbnail,
    // but moving to Storage URLs will fix the weight.
    let query = supabase
      .from('entries')
      .select('id, status, date, supplier_invoice_no, party_name, party_name_raw, total, image_url, created_at')
      .order('created_at', { ascending: false });

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

    // 3. Trigger background processing reliably
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    // Use waitUntil to ensure the background process starts before the function ends
    waitUntil(
      fetch(`${baseUrl}/api/entries/${entryId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(err => console.error('Background trigger failed:', err))
    );

    return NextResponse.json({ entry });
  } catch (err) {
    console.error('POST /api/entries error:', err);
    // Return the specific error message to help debugging
    return NextResponse.json({ 
      error: err.message || 'Unknown upload error',
      details: err
    }, { status: 500 });
  }
}
