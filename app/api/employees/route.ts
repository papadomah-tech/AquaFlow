import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Helper: verify the caller is authenticated
async function getCallerUid(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return null
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await anonClient.auth.getUser(token)
  return user?.id ?? null
}

// Service-role client — bypasses RLS
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// PUT /api/employees  — update an existing employee
export async function PUT(req: NextRequest) {
  try {
    const uid = await getCallerUid(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id: rawId, ...payload } = body
    const id = parseInt(String(rawId), 10)

    if (!id || isNaN(id)) return NextResponse.json({ error: 'id is required and must be a number' }, { status: 400 })

    // Sanitize numerics
    const clean: Record<string, any> = { ...payload }
    if (clean.salary         !== undefined) clean.salary         = parseFloat(clean.salary)         || 0
    if (clean.base_pay       !== undefined) clean.base_pay       = parseFloat(clean.base_pay)       || 0
    if (clean.feeding_fee    !== undefined) clean.feeding_fee    = parseFloat(clean.feeding_fee)    || 300
    if (clean.monthly_target !== undefined) clean.monthly_target = parseInt(clean.monthly_target)   || 6500
    if (clean.sales_target_daily !== undefined) clean.sales_target_daily = parseInt(clean.sales_target_daily) || 250
    if (clean.working_days   !== undefined) clean.working_days   = parseInt(clean.working_days)     || 26
    // Never persist UI-only field
    delete clean.selling_price

    const { data, error, count } = await adminClient()
      .from('employees')
      .update(clean)
      .eq('id', id)
      .select()

    if (error) return NextResponse.json({ error: error.message, debug: { id, clean } }, { status: 400 })
    if (!data || data.length === 0) {
      // Double-check: does this row actually exist?
      const { data: existing } = await adminClient().from('employees').select('id').eq('id', id)
      return NextResponse.json({
        error: `No rows updated — employee id ${id} not found`,
        debug: { id, idType: typeof rawId, existingRows: existing }
      }, { status: 404 })
    }

    return NextResponse.json({ success: true, employee: data[0] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

// POST /api/employees  — insert a new employee
export async function POST(req: NextRequest) {
  try {
    const uid = await getCallerUid(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const clean: Record<string, any> = { ...body }
    if (clean.salary         !== undefined) clean.salary         = parseFloat(clean.salary)         || 0
    if (clean.base_pay       !== undefined) clean.base_pay       = parseFloat(clean.base_pay)       || 0
    if (clean.feeding_fee    !== undefined) clean.feeding_fee    = parseFloat(clean.feeding_fee)    || 300
    if (clean.monthly_target !== undefined) clean.monthly_target = parseInt(clean.monthly_target)   || 6500
    if (clean.sales_target_daily !== undefined) clean.sales_target_daily = parseInt(clean.sales_target_daily) || 250
    if (clean.working_days   !== undefined) clean.working_days   = parseInt(clean.working_days)     || 26
    delete clean.selling_price

    const { data, error } = await adminClient()
      .from('employees')
      .insert(clean)
      .select()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, employee: data?.[0] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
