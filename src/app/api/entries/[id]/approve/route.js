import { NextResponse } from 'next/server';
import { supabase, isDemoMode } from '@/lib/supabase';
import { demoStore } from '@/lib/demo-store';

// POST /api/entries/[id]/approve
export async function POST(request, { params }) {
  const { id } = await params;
  try {
    if (isDemoMode) {
      const entry = demoStore.updateEntry(id, { status: 'approved' });
      if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ entry });
    }

    const { data: entry, error } = await supabase
      .from('entries')
      .update({ status: 'approved' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
