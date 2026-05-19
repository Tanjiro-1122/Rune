import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// createClient is called inside the handler — never at build time
function getSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://hvvrbpvsgjxiicigkwhu.supabase.co';
  const key =
    process.env.RUNE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('rune:authenticated:v2');
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || '';

  try {
    const supabase = getSupabase();
    let query = supabase
      .from('phrourio_vault')
      .select('id,service_name,username,encrypted_password,iv,url,category,notes,favorite,is_weak')
      .order('service_name');

    if (search) query = query.ilike('service_name', `%${search}%`);
    if (category && category !== 'All') query = query.eq('category', category);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { decryptVaultPassword } = await import('@/lib/vault');
    const decrypted = (data || []).map(item => ({
      ...item,
      password: decryptVaultPassword(item.encrypted_password, item.iv),
      encrypted_password: undefined,
      iv: undefined,
    }));

    return NextResponse.json({ items: decrypted, count: decrypted.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get('rune:authenticated:v2');
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = getSupabase();
    const body = await req.json();
    const { id, ...fields } = body;

    if (id) {
      const { error } = await supabase.from('phrourio_vault').update(fields).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    } else {
      const { data, error } = await supabase.from('phrourio_vault').insert(fields).select('id').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ id: data.id });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const cookie = req.cookies.get('rune:authenticated:v2');
  if (!cookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = getSupabase();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await supabase.from('phrourio_vault').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
