'use client'
export const dynamic = 'force-dynamic'
import { useState, useRef } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ── CSV parser ─────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g,'_'))
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, '')
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== ''))
}

// ── Template definitions ───────────────────────────────────────────────────
const TEMPLATES = {
  customers: {
    label: 'Customers',
    icon: '👤',
    columns: ['name', 'phone', 'email', 'address'],
    required: ['name'],
    example: 'name,phone,email,address\nKwame Asante,0241234567,kwame@email.com,Takoradi\nAma Boateng,0551234567,,Sekondi',
    map: (r: any) => ({ name: r.name, phone: r.phone||null, email: r.email||null, address: r.address||null }),
    table: 'customers',
  },
  employees: {
    label: 'Employees',
    icon: '👥',
    columns: ['full_name','role','phone','salary','sales_target_daily','hire_date'],
    required: ['full_name','role','hire_date'],
    example: 'full_name,role,phone,salary,sales_target_daily,hire_date\nOdame Stephen,Sales Officer,0241234567,1300,250,2025-01-01',
    map: (r: any) => ({
      full_name: r.full_name, role: r.role, phone: r.phone||null,
      salary: parseFloat(r.salary)||0,
      sales_target_daily: parseInt(r.sales_target_daily)||250,
      hire_date: r.hire_date, status: 'active', working_days: 6,
    }),
    table: 'employees',
  },
  expenses: {
    label: 'Expenses',
    icon: '💸',
    columns: ['expense_date','category','description','amount','paid_to'],
    required: ['expense_date','category','description','amount'],
    example: 'expense_date,category,description,amount,paid_to\n2026-06-01,Transport,Delivery fuel,150,Driver',
    map: (r: any) => ({
      expense_date: r.expense_date, category: r.category,
      description: r.description, amount: parseFloat(r.amount)||0,
      paid_to: r.paid_to||null,
    }),
    table: 'expenses',
  },
  sales: {
    label: 'Sales (basic)',
    icon: '💼',
    columns: ['sale_date','customer_name','bags_sold','unit_price','amount_paid','notes'],
    required: ['sale_date','bags_sold','unit_price'],
    example: 'sale_date,customer_name,bags_sold,unit_price,amount_paid,notes\n2026-06-01,Kwame Asante,50,6,300,',
    map: null, // handled specially
    table: 'sales',
  },
  raw_materials: {
    label: 'Raw Materials',
    icon: '🧱',
    columns: ['name','unit','current_stock','low_stock_threshold'],
    required: ['name','unit'],
    example: 'name,unit,current_stock,low_stock_threshold\nWater,Litres,5000,500\nPackaging Bags,Units,10000,1000',
    map: (r: any) => ({
      name: r.name, unit: r.unit,
      current_stock: parseFloat(r.current_stock)||0,
      low_stock_threshold: parseFloat(r.low_stock_threshold)||0,
    }),
    table: 'raw_materials',
  },
}

type TemplateKey = keyof typeof TEMPLATES

export default function ImportPage() {
  const { isAdmin, loading: roleLoading } = useRole()
  const [selected, setSelected]   = useState<TemplateKey>('customers')
  const [preview, setPreview]     = useState<any[]>([])
  const [fileName, setFileName]   = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<{ok:number; errors:string[]} | null>(null)
  const [showExample, setShowExample] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (roleLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">Loading...</div>
    </AppLayout>
  )
  if (!isAdmin) return <AccessDenied message="Only administrators can import data." />

  const tmpl = TEMPLATES[selected]

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const rows = parseCSV(ev.target?.result as string)
      setPreview(rows.slice(0, 5))
    }
    reader.readAsText(file)
  }

  const doImport = async () => {
    if (!fileRef.current?.files?.[0]) return
    setImporting(true)
    setResult(null)
    const text = await fileRef.current.files[0].text()
    const rows = parseCSV(text)
    let ok = 0
    const errors: string[] = []

    if (selected === 'sales') {
      // Special: look up or create customer by name
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        try {
          // Get or create customer
          let custId: number | null = null
          if (r.customer_name) {
            const { data: existing } = await supabase
              .from('customers').select('id').eq('name', r.customer_name).single()
            if (existing) {
              custId = existing.id
            } else {
              const { data: created } = await supabase
                .from('customers').insert({ name: r.customer_name }).select().single()
              custId = created?.id ?? null
            }
          }
          if (!custId) {
            // Walk-in
            const { data: wi } = await supabase
              .from('customers').select('id').eq('name','Walk-in Customer').single()
            custId = wi?.id ?? null
            if (!custId) {
              const { data: wic } = await supabase
                .from('customers').insert({ name:'Walk-in Customer' }).select().single()
              custId = wic?.id
            }
          }
          const bags  = parseInt(r.bags_sold)||0
          const price = parseFloat(r.unit_price)||0
          const paid  = parseFloat(r.amount_paid)||0
          const total = bags * price
          const bal   = Math.max(0, total - paid)
          await supabase.from('sales').insert({
            sale_date: r.sale_date, customer_id: custId,
            bags_sold: bags, unit_price: price, total_amount: total,
            amount_paid: paid, outstanding_balance: bal,
            payment_status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
            notes: r.notes||null,
          })
          // Update finished inventory
          await supabase.from('finished_inventory').insert({
            bags_in: 0, bags_out: bags,
            transaction_date: r.sale_date,
            reference_type: 'sale', notes: `Imported sale — ${r.customer_name||'Walk-in'}`,
          })
          ok++
        } catch (e: any) {
          errors.push(`Row ${i+2}: ${e.message ?? 'error'}`)
        }
      }
    } else {
      // Standard tables
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        // Check required fields
        const missing = tmpl.required.filter(f => !r[f])
        if (missing.length) {
          errors.push(`Row ${i+2}: missing ${missing.join(', ')}`)
          continue
        }
        try {
          const payload = tmpl.map!(r)
          await (supabase.from(tmpl.table as any) as any).insert(payload)
          ok++
        } catch (e: any) {
          errors.push(`Row ${i+2}: ${e.message ?? 'error'}`)
        }
      }
    }
    setImporting(false)
    setResult({ ok, errors })
    // Reset file
    if (fileRef.current) fileRef.current.value = ''
    setPreview([])
    setFileName('')
  }

  const downloadExample = () => {
    const blob = new Blob([tmpl.example], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `aquaflow_${selected}_template.csv`
    a.click()
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">📥 Import Data</h1>
        <span className="badge badge-blue">Admin Only</span>
      </div>

      {/* Instructions */}
      <div className="card mb-4 bg-blue-50 border border-blue-200">
        <div className="font-semibold text-[#1F4E79] mb-1">How it works</div>
        <div className="text-sm text-gray-600 space-y-1">
          <div>1. Select the type of data you want to import</div>
          <div>2. Download the CSV template — fill it in using Excel or Google Sheets</div>
          <div>3. Upload the completed CSV file and click Import</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Left — type selector */}
        <div className="card">
          <div className="font-semibold text-[#1F4E79] mb-3 text-sm">Select Data Type</div>
          <div className="space-y-2">
            {(Object.entries(TEMPLATES) as [TemplateKey, typeof TEMPLATES[TemplateKey]][]).map(([key, t]) => (
              <button key={key} onClick={() => { setSelected(key); setPreview([]); setResult(null) }}
                className={'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 '
                  + (selected === key
                    ? 'bg-[#1F4E79] text-white font-semibold'
                    : 'hover:bg-gray-50 text-gray-700')}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right — upload area */}
        <div className="md:col-span-2 space-y-4">

          {/* Template download */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-[#1F4E79] text-sm">
                {tmpl.icon} {tmpl.label} — CSV Template
              </div>
              <button onClick={downloadExample}
                className="btn btn-secondary btn-sm">
                ⬇ Download Template
              </button>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              Required columns: <span className="font-medium text-gray-700">
                {tmpl.required.join(', ')}
              </span>
            </div>
            <div className="text-xs text-gray-400">
              All columns: {tmpl.columns.join(', ')}
            </div>
            <button onClick={() => setShowExample(s => !s)}
              className="text-xs text-blue-600 mt-2 hover:underline">
              {showExample ? 'Hide' : 'Show'} example
            </button>
            {showExample && (
              <pre className="mt-2 bg-gray-50 rounded-lg p-3 text-xs text-gray-600
                             overflow-x-auto whitespace-pre">
                {tmpl.example}
              </pre>
            )}
          </div>

          {/* Upload */}
          <div className="card">
            <div className="font-semibold text-[#1F4E79] text-sm mb-3">Upload CSV File</div>
            <label className={'flex flex-col items-center justify-center border-2 border-dashed '
              + 'rounded-xl p-8 cursor-pointer transition-colors '
              + (fileName ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-[#2E75B6] hover:bg-blue-50')}>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              <div className="text-3xl mb-2">{fileName ? '✅' : '📄'}</div>
              <div className="text-sm font-medium text-gray-700">
                {fileName || 'Click to select CSV file'}
              </div>
              {!fileName && (
                <div className="text-xs text-gray-400 mt-1">or drag and drop</div>
              )}
            </label>

            {/* Preview */}
            {preview.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Preview (first {preview.length} rows)
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        {Object.keys(preview[0]).map(h => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((v: any, j) => (
                            <td key={j} className="text-xs">{v || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {fileName && (
              <button onClick={doImport} disabled={importing}
                className="btn btn-primary w-full justify-center mt-4 py-2.5">
                {importing ? '⏳ Importing...' : `📥 Import ${tmpl.label}`}
              </button>
            )}
          </div>

          {/* Result */}
          {result && (
            <div className={'card border-l-4 ' + (result.errors.length === 0 ? 'border-green-500' : 'border-orange-400')}>
              <div className={'font-bold mb-2 ' + (result.errors.length === 0 ? 'text-green-700' : 'text-orange-600')}>
                {result.errors.length === 0
                  ? `✅ Import complete — ${result.ok} rows added`
                  : `⚠️ Imported ${result.ok} rows with ${result.errors.length} error(s)`}
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
