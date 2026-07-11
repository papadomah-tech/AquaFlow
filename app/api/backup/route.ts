import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const TABLES = [
  'profiles','employees','customers','sales','payments','bulk_returns',
  'production_batches','finished_inventory','stock_takes','stock_take_items',
  'stock_adjustments','raw_materials','raw_material_purchases','raw_material_usage',
  'roll_films','expenses','imprest_entries','imprest_floats','bank_deposits',
  'salary_payments','employee_losses','attendance','rider_sales','rider_payments',
  'opening_balances',
]

function toCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return 'No data'
  const headers = Object.keys(rows[0])
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check admin role
    const { data: profile } = await anonClient.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const fmt = new URL(req.url).searchParams.get('fmt') ?? 'csv'

    if (fmt === 'csv') {
      // Build a ZIP server-side — much faster than in browser
      // Return all CSVs as JSON, client will ZIP them
      const results: Record<string, string> = {}
      await Promise.all(TABLES.map(async t => {
        try {
          const { data } = await admin.from(t).select('*').limit(100000)
          results[t] = toCSV(data ?? [])
        } catch {
          results[t] = 'Error fetching data'
        }
      }))
      return NextResponse.json({ success: true, data: results, tables: TABLES })
    }

    if (fmt === 'excel') {
      // Build Excel server-side using ExcelJS (lighter than xlsx for streaming)
      const ExcelJS = (await import('exceljs'))
      const wb = new ExcelJS.default.Workbook()
      wb.creator = 'AquaFlow Manager'
      wb.created = new Date()

      const tableData: Record<string, any[]> = {}
      await Promise.all(TABLES.map(async t => {
        try {
          const { data } = await admin.from(t).select('*').limit(100000)
          tableData[t] = data ?? []
        } catch {
          tableData[t] = []
        }
      }))

      // Build sheets sequentially (ExcelJS requirement)
      for (const t of TABLES) {
        const rows = tableData[t]
        const sheetName = t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 31)
        const ws = wb.addWorksheet(sheetName)
        if (rows.length > 0) {
          const headers = Object.keys(rows[0])
          ws.addRow(headers)
          rows.forEach(r => ws.addRow(headers.map(h => r[h])))
          // Bold header
          ws.getRow(1).font = { bold: true }
        } else {
          ws.addRow(['No data'])
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="aquaflow-backup-${new Date().toISOString().slice(0,10)}.xlsx"`,
        }
      })
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
