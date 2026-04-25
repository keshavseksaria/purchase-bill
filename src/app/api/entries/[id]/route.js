import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';

// GET /api/entries/[id]
export async function GET(request, { params }) {
  const { id } = await params;
  try {
    if (isDemoMode) {
      const entry = demoStore.getEntry(id);
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const items = demoStore.getEntryItems(id);
      return NextResponse.json({ entry, items });
    }

    const { data: entry, error } = await supabase
      .from('entries').select('*').eq('id', id).single();
    if (error) throw error;

    const { data: items } = await supabase
      .from('entry_items').select('*').eq('entry_id', id).order('sort_order');

    return NextResponse.json({ entry, items: items || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/entries/[id] — update entry + items
export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { entry: entryData, items } = body;

    if (isDemoMode) {
      const updated = demoStore.updateEntry(id, entryData);
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (items) demoStore.setEntryItems(id, items);
      return NextResponse.json({ entry: updated, items: demoStore.getEntryItems(id) });
    }

    // Update entry
    const { data: entry, error: entryErr } = await supabase
      .from('entries').update(entryData).eq('id', id).select().single();
    if (entryErr) throw entryErr;

    // Replace items
    if (items) {
      await supabase.from('entry_items').delete().eq('entry_id', id);
      if (items.length > 0) {
        const itemsWithEntry = items.map((item, idx) => ({
          ...item,
          id: item.id || crypto.randomUUID(),
          entry_id: id,
          sort_order: idx,
        }));
        const { error: itemsErr } = await supabase.from('entry_items').insert(itemsWithEntry);
        if (itemsErr) throw itemsErr;
      }
    }

    const { data: updatedItems } = await supabase
      .from('entry_items').select('*').eq('entry_id', id).order('sort_order');

    return NextResponse.json({ entry, items: updatedItems || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/entries/[id]
export async function DELETE(request, { params }) {
  const { id } = await params;
  try {
    if (isDemoMode) {
      demoStore.deleteEntry(id);
      return NextResponse.json({ success: true });
    }

    await supabase.from('entry_items').delete().eq('entry_id', id);
    await supabase.from('entries').delete().eq('id', id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
