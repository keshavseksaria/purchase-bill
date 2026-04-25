import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';
import { generateTallyXML } from '@/lib/tally-xml';

// GET /api/bridge/pending — returns approved entries for Tally Bridge to sync
export async function GET(request) {
  try {
    if (isDemoMode) {
      const entries = demoStore.getApprovedEntries();
      const result = entries.map(entry => ({
        entry,
        items: demoStore.getEntryItems(entry.id),
        xml: generateTallyXML(entry, demoStore.getEntryItems(entry.id)),
      }));
      return NextResponse.json(result);
    }

    const { data: entries, error } = await supabase
      .from('entries')
      .select('*')
      .eq('status', 'approved');
    if (error) throw error;

    const result = [];
    for (const entry of (entries || [])) {
      const { data: items } = await supabase
        .from('entry_items')
        .select('*')
        .eq('entry_id', entry.id)
        .order('sort_order');

      result.push({
        entry,
        items: items || [],
        xml: generateTallyXML(entry, items || []),
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/bridge/pending — update status after sync attempt
export async function POST(request) {
  try {
    const body = await request.json();
    const { id, status, error_message } = body;

    if (isDemoMode) {
      demoStore.updateEntry(id, { status, error_message: error_message || null });
      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from('entries')
      .update({ status, error_message: error_message || null })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
