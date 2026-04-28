import { NextResponse } from 'next/server';
import { processBill } from '@/lib/processor';

export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id: entryId } = await params;

  try {
    const result = await processBill(entryId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
