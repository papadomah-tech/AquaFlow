import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

async function getCallerUid(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return null
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: { user } } = await c.auth.getUser(token)
  return user?.id ?? null
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function PUT(req: NextRequest) {
  try {
    const uid = await getCallerUid(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const id = parseInt(String(body.id), 10)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const bp  = body.base_pay !== undefined && body.base_pay !== '' ? parseFloat(body.base_pay) : 0
    const ff  = body.feeding_fee !== undefined && body.feeding_fee !== '' ? parseFloat(body.feeding_fee) : 300
    const sal = parseFloat(body.salary)      || 0
    const mt  = parseInt(body.monthly_target)   || 6500
    const std = parseInt(body.sales_target_daily) || 250
    const wd  = parseInt(body.working_days)  || 26

    // Use rpc raw SQL to guarantee the update goes through
    const { data, error } = await admin().rpc('update_employee_pay', {
      p_id:         id,
      p_full_name:  body.full_name  ?? '',
      p_role:       body.role       ?? '',
      p_phone:      body.phone      ?? '',
      p_hire_date:  body.hire_date  ?? '',
      p_emp_type:   body.employee_type ?? 'staff',
      p_salary:     sal,
      p_base_pay:   bp,
      p_feeding_fee: ff,
      p_monthly_target: mt,
      p_sales_target_daily: std,
      p_working_days: wd,
    })

    if (error) return NextResponse.json({ error: error.message, hint: error.hint }, { status: 400 })
    return NextResponse.json({ success: true, updated: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await getCallerUid(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const clean: Record<string, any> = { ...body }
    clean.salary             = parseFloat(clean.salary)             || 0
    if (clean.base_pay !== undefined && clean.base_pay !== '') clean.base_pay = parseFloat(clean.base_pay)
    if (clean.feeding_fee !== undefined && clean.feeding_fee !== '') clean.feeding_fee = parseFloat(clean.feeding_fee)
    clean.monthly_target     = parseInt(clean.monthly_target)       || 6500
    clean.sales_target_daily = parseInt(clean.sales_target_daily)   || 250
    clean.working_days       = parseInt(clean.working_days)         || 26
    delete clean.selling_price
    delete clean.id

    const { data, error } = await admin().from('employees').insert(clean).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, employee: data?.[0] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
