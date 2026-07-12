import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const TABLES: { key: string; dateCol: string; label: string }[] = [
  { key: 'sales',                  dateCol: 'sale_date',      label: 'Sales' },
  { key: 'production_batches',     dateCol: 'batch_date',     label: 'Production' },
  { key: 'finished_inventory',     dateCol: 'transaction_date', label: 'Stock Ledger' },
  { key: 'expenses',               dateCol: 'expense_date',   label: 'Expenses' },
  { key: 'imprest_entries',        dateCol: 'entry_date',     label: 'Imprest' },
  { key: 'bank_deposits',          dateCol: 'deposit_date',   label: 'Bank Deposits' },
  { key: 'raw_material_purchases', dateCol: 'purchase_date',  label: 'RM Purchases' },
  { key: 'raw_material_usage',     dateCol: 'usage_date',     label: 'RM Usage' },
  { key: 'salary_payments',        dateCol: 'payment_date',   label: 'Salary Payments' },
  { key: 'employee_losses',        dateCol: 'loss_date',      label: 'Employee Losses' },
  { key: 'bulk_returns',           dateCol: 'return_date',    label: 'Bulk Returns' },
  { key: 'rider_sales',            dateCol: 'sale_date',      label: 'Rider Sales' },
  { key: 'stock_takes',            dateCol: 'take_date',      label: 'Stock Takes' },
  { key: 'stock_adjustments',      dateCol: 'adjustment_date', label: 'Stock Adjustments' },
]

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getUser(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return null
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data: { user } } = await anon.auth.getUser(token)
  if (!user) return null
  const { data: profile } = await admin().from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return user
}

// POST /api/archive — archive records before cutoff date
export async function POST(req: NextRequest) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const { cutoff_date, notes } = await req.json()
    if (!cutoff_date) return NextResponse.json({ error: 'cutoff_date required' }, { status: 400 })

    const db = admin()
    const counts: Record<string, number> = {}

    // Archive each table
    for (const t of TABLES) {
      try {
        const { data: rows } = await db.from(t.key).select('id').lt(t.dateCol, cutoff_date).eq('is_archived', false)
        counts[t.label] = rows?.length ?? 0
        if (counts[t.label] > 0) {
          await db.from(t.key).update({ is_archived: true }).lt(t.dateCol, cutoff_date).eq('is_archived', false)
        }
      } catch { counts[t.label] = 0 }
    }

    // Log the archive operation
    await db.from('archive_log').insert({
      cutoff_date,
      archived_by: user.id,
      record_counts: counts,
      notes: notes || null,
    })

    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return NextResponse.json({ success: true, counts, total })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/archive/:id — unarchive (reverse) an archive operation
export async function DELETE(req: NextRequest) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const { log_id } = await req.json()
    if (!log_id) return NextResponse.json({ error: 'log_id required' }, { status: 400 })

    const db = admin()
    const { data: log } = await db.from('archive_log').select('*').eq('id', log_id).single()
    if (!log) return NextResponse.json({ error: 'Archive log not found' }, { status: 404 })
    if (log.is_reversed) return NextResponse.json({ error: 'Already reversed' }, { status: 400 })

    // Unarchive all tables for records before the cutoff date
    for (const t of TABLES) {
      try {
        await db.from(t.key).update({ is_archived: false }).lt(t.dateCol, log.cutoff_date).eq('is_archived', true)
      } catch { /* continue */ }
    }

    // Mark log as reversed
    await db.from('archive_log').update({ is_reversed: true, reversed_at: new Date().toISOString() }).eq('id', log_id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/archive — list archive logs
export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const { data } = await admin().from('archive_log').select('*').order('archived_at', { ascending: false })
    return NextResponse.json({ logs: data ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
