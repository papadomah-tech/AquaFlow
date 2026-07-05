'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart, countWorkingDays, calcPerfPay, fmtDate} from '@/lib/supabase'

function PersonnelPageInner() {
  const [tab, setTab] = useState<'employees'|'perf'|'losses'|'salary'>('employees')
  const [employees, setEmployees] = useState<any[]>([])
  const [losses, setLosses] = useState<any[]>([])
  const [salaryPay, setSalaryPay] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showEmpForm, setShowEmpForm] = useState(false)
  const [showLossForm, setShowLossForm] = useState(false)
  const [editEmp, setEditEmp] = useState<any>(null)
  const [period, setPeriod] = useState({ from: monthStart(), to: today() })
  const [perfData, setPerfData] = useState<any[]>([])

  // Pricing rates for target viability analysis
  const PRICING = {
    roll_cost_per_kg: 45, bags_per_kg: 20,
    pkg_bulk_qty: 1000, pkg_bulk_cost: 640,
    water_cost_per_liter: 0.0318, liters_per_bag: 15,
    operator_fee_per_100: 30,
    labor_per_bag: 0.50, utility_per_bag: 0.20, machine_per_bag: 0.10,
    std_days: 26,
  }

  const [empForm, setEmpForm] = useState({ full_name:'', role:'', phone:'', salary:'', sales_target_daily:'250', working_days:'6', hire_date:today(), employee_type:'staff', base_pay:'', feeding_fee:'300', monthly_target:'6500', selling_price:'6' })
  const [lossForm, setLossForm] = useState({ employee_id:'', loss_date:today(), loss_type:'Bag Shortage', description:'', quantity:'', unit_cost:'', notes:'' })

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: emp }, { data: el }, { data: sp }] = await Promise.all([
      supabase.from('employees').select('*').order('full_name').gt('id', 0),
      supabase.from('employee_losses').select('*,employees(full_name)').order('loss_date', { ascending: false }),
      supabase.from('salary_payments').select('*,employees(full_name)').order('payment_date', { ascending: false }).limit(100),
    ])
    setEmployees(emp ?? [])
    setLosses(el ?? [])
    setSalaryPay(sp ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const calcPerformance = useCallback(async () => {
    const activeEmp = employees.filter((e: any) => e.status === 'active')

    const results = await Promise.all(activeEmp.map(async (emp: any) => {
      let bags = 0

      if (emp.employee_type === 'factory_manager' || emp.role?.toLowerCase().includes('manager')) {
        // Factory Manager: total bags OUT from finished_inventory in period
        const { data: fi } = await supabase.from('finished_inventory')
          .select('bags_out')
          .gte('transaction_date', period.from)
          .lte('transaction_date', period.to)
        bags = (fi ?? []).reduce((a: number, r: any) => a + r.bags_out, 0)
      } else if (emp.employee_type === 'rider') {
        // Rider: bags from bulk dispatches where they are primary rider OR teammate
        // Full bag count credits both — no splitting
        const [{ data: primarySales }, { data: teammateSales }] = await Promise.all([
          supabase.from('sales').select('bags_sold')
            .eq('sale_type', 'bulk').eq('buyer_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
          supabase.from('sales').select('bags_sold')
            .eq('sale_type', 'bulk').eq('teammate_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
        ])
        // Combine — full count for both roles
        bags = [...(primarySales ?? []), ...(teammateSales ?? [])]
          .reduce((a: number, s: any) => a + s.bags_sold, 0)
      } else {
        // Other staff: retail sales they recorded
        const { data: sales } = await supabase.from('sales')
          .select('bags_sold')
          .eq('salesperson_id', emp.id)
          .gte('sale_date', period.from)
          .lte('sale_date', period.to)
        bags = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
      }

      const { data: pendingLosses } = await supabase.from('employee_losses')
        .select('loss_amount').eq('employee_id', emp.id).eq('posted', false)
      const totalLosses = (pendingLosses ?? []).reduce((a: number, l: any) => a + l.loss_amount, 0)

      const { data: lockRow } = await supabase.from('salary_payments')
        .select('id,amount,payment_date')
        .eq('employee_id', emp.id).eq('payment_type','performance')
        .eq('period_start', period.from).eq('period_end', period.to).limit(1)
      const locked = lockRow && lockRow.length > 0

      // VeeBee proportional formula
      const basePay      = emp.base_pay || emp.salary || 0
      const feedingFee   = emp.feeding_fee ?? 300
      const monthlyTarget= emp.monthly_target || emp.sales_target_daily * 26 || 6500
      const perf = calcPerfPay({ basePay, feedingFee, monthlyTarget, actualBags: bags })

      return {
        ...emp, bags, basePay, monthlyTarget,
        ...perf,
        totalLosses,
        netPay: Math.max(0, perf.total - totalLosses),
        locked, lockInfo: lockRow?.[0]
      }
    }))
    setPerfData(results)
  }, [employees, period])

  const payEmployee = async (d: any) => {
    if (d.locked) { alert('Period already paid on ' + d.lockInfo?.payment_date); return }
    if (d.netPay <= 0) { alert('Net pay is zero or negative. No payment recorded.'); return }
    if (!confirm(`Pay ${d.full_name}?\n\nBase Pay Earned: ${fmtGhc(d.earnedBase)}\nFeeding Fee: ${fmtGhc(d.feedingFee)}\nGross Pay: ${fmtGhc(d.total)}\nLosses Deducted: ${fmtGhc(d.totalLosses)}\nNet Pay: ${fmtGhc(d.netPay)}\n\nPeriod: ${period.from} to ${period.to}`)) return
    await supabase.from('salary_payments').insert({ employee_id: d.id, payment_date: today(), amount: d.netPay, payment_type: 'performance', period_start: period.from, period_end: period.to, notes: `Period pay: ${period.from} to ${period.to} | Base: ${fmtGhc(d.earnedBase)} + Feeding: ${fmtGhc(d.feedingFee)} - Losses: ${fmtGhc(d.totalLosses)}` })
    await supabase.from('expenses').insert({ expense_date: today(), category: 'Salary', description: `Performance pay - ${d.full_name} (${period.from} to ${period.to})`, amount: d.netPay })
    // Mark losses as posted
    await supabase.from('employee_losses').update({ posted: true, posted_date: today() }).eq('employee_id', d.id).eq('posted', false)
    calcPerformance()
    loadAll()
  }

  const saveEmployee = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { alert('Session expired — please log out and log back in.'); return }

    const body: Record<string, any> = {
      full_name:          empForm.full_name,
      role:               empForm.role,
      phone:              empForm.phone,
      hire_date:          empForm.hire_date,
      employee_type:      empForm.employee_type,
      salary:             empForm.salary,
      base_pay:           empForm.base_pay || empForm.salary,
      feeding_fee:        empForm.feeding_fee,
      monthly_target:     empForm.monthly_target,
      sales_target_daily: empForm.sales_target_daily,
      working_days:       empForm.working_days,
    }
    if (editEmp) body.id = editEmp.id

    // DEBUG: show exactly what will be sent
    if (!confirm(`Sending to DB:\nbase_pay: ${body.base_pay}\nfeeding_fee: ${body.feeding_fee}\nsalary: ${body.salary}\nid: ${body.id ?? 'NEW'}\n\nClick OK to save.`)) return

    const res = await fetch('/api/employees', {
      method: editEmp ? 'PUT' : 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })

    const json = await res.json()
    if (!res.ok || json.error) {
      alert(`Save failed: ${json.error ?? res.statusText}`)
      return
    }

    setShowEmpForm(false); loadAll()
  }

  const saveLoss = async () => {
    const qty  = parseFloat(lossForm.quantity) || 0
    const uc   = parseFloat(lossForm.unit_cost) || 0
    const amt  = qty * uc
    await supabase.from('employee_losses').insert({ ...lossForm, employee_id: parseInt(lossForm.employee_id), quantity: qty, unit_cost: uc, loss_amount: amt })
    setShowLossForm(false); loadAll()
  }

  const LOSS_TYPES = ['Bag Shortage','Cash Shortage','Stock Damage','Equipment Damage','Transport Loss','Other']

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Personnel</h1>
        <div className="flex gap-2">
          <button onClick={() => { setEditEmp(null); setEmpForm({full_name:'',role:'',phone:'',salary:'',sales_target_daily:'250',working_days:'6',hire_date:today(),employee_type:'staff',base_pay:'',feeding_fee:'300',monthly_target:'6500',selling_price:'6'}); setShowEmpForm(true) }} className="btn btn-primary">+ Employee</button>
          <button onClick={() => { setShowLossForm(true) }} className="btn btn-warning">+ Record Loss</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['employees','perf','losses','salary'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); if(t==='perf') calcPerformance() }} className={'btn btn-sm ' + (tab===t?'btn-primary':'btn-secondary')}>
            {t==='employees'?'Employees':t==='perf'?'Performance Pay':t==='losses'?'Loss Register':'Salary Payments'}
          </button>
        ))}
      </div>

      {/* EMPLOYEES TAB */}
      {tab === 'employees' && (
        <div className="card">
          <table className="data-table">
            <colgroup>
            <col style={{width:'140px'}} /><col style={{width:'115px'}} /><col style={{width:'100px'}} />
            <col style={{width:'105px'}} /><col style={{width:'100px'}} />
            <col style={{width:'75px'}} /><col style={{width:'180px'}} />
          </colgroup>
          <thead><tr>
            <th>Name</th><th>Role</th><th>Phone</th>
            <th className="right">Monthly Sal.</th><th className="right">Daily Target</th>
            <th>Status</th><th>Actions</th>
          </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
              : employees.map((e: any) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.full_name}</td>
                  <td className="muted">{e.role}</td>
                  <td className="text-xs text-gray-500">{e.phone||'-'}</td>
                  <td className="num">{fmtGhc(e.salary)}</td>
                  <td className="num">{e.sales_target_daily}/day</td>
                  <td><span className={'badge '+(e.status==='active'?'badge-green':'badge-gray')}>{e.status}</span></td>
                  <td><div className="flex gap-1">
                    <button onClick={()=>{setEditEmp(e);setEmpForm({full_name:e.full_name,role:e.role,phone:e.phone??'',salary:String(e.salary),sales_target_daily:String(e.sales_target_daily),working_days:String(e.working_days),hire_date:e.hire_date,employee_type:e.employee_type??'staff',base_pay:String(e.base_pay??e.salary??''),feeding_fee:String(e.feeding_fee??300),monthly_target:String(e.monthly_target??6500),selling_price:'6'});setShowEmpForm(true)}} className="btn btn-sm btn-secondary">Edit</button>
                    <button onClick={async()=>{if(confirm('Toggle status?'))await supabase.from('employees').update({status:e.status==='active'?'inactive':'active'}).eq('id',e.id);loadAll()}} className="btn btn-sm btn-warning">{e.status==='active'?'Deactivate':'Activate'}</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PERFORMANCE PAY TAB — VeeBee Proportional Framework */}
      {tab === 'perf' && (
        <>
          <div className="card mb-4 bg-blue-50 border border-blue-200">
            <div className="text-xs font-semibold text-blue-800 mb-1">VeeBee Performance Pay Formula</div>
            <div className="text-xs text-blue-700">
              Monthly Pay = (Actual Bags ÷ Monthly Target) × Base Pay + Feeding Fee
              &nbsp;|&nbsp; No cap — overperformance earns above base.
              &nbsp;|&nbsp; Feeding fee always paid in full.
            </div>
          </div>
          <div className="card mb-4">
            <div className="flex gap-3 items-end flex-wrap">
              <div><label className="form-label">From</label><input type="date" value={period.from} onChange={e=>setPeriod(p=>({...p,from:e.target.value}))} className="form-input w-36" /></div>
              <div><label className="form-label">To</label><input type="date" value={period.to} onChange={e=>setPeriod(p=>({...p,to:e.target.value}))} className="form-input w-36" /></div>
              <button onClick={calcPerformance} className="btn btn-primary">Calculate</button>
              <button onClick={()=>setPeriod({from:monthStart(),to:today()})} className="btn btn-secondary">This Month</button>
            </div>
          </div>
          <div className="space-y-4">
            {perfData.length === 0
              ? <div className="card text-center py-8 text-gray-400">Click Calculate to see performance data</div>
            : perfData.map((d: any) => (
              <div key={d.id} className={'card border-l-4 '
                + (d.locked ? 'border-gray-300 bg-gray-50'
                : d.pct >= 100 ? 'border-green-500'
                : d.pct >= 60  ? 'border-orange-400'
                : 'border-red-400')}>

                {/* Header row */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3 pb-3 border-b border-gray-100">
                  <div>
                    <div className="font-bold text-[#1F4E79]">
                      {d.locked ? '🔒 ' : ''}{d.full_name}
                      <span className="text-xs font-normal text-gray-400 ml-2">({d.role})</span>
                      <span className={'text-xs font-medium ml-2 '
                        + (d.employee_type === 'rider' ? 'text-orange-600'
                        : d.employee_type === 'factory_manager' ? 'text-purple-600'
                        : 'text-gray-500')}>
                        {d.employee_type === 'rider' ? '🛵 Rider'
                        : d.employee_type === 'factory_manager' ? '🏭 Factory Mgr'
                        : '👤 Staff'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {d.employee_type === 'rider'
                        ? `Bulk bags dispatched: ${fmtNum(d.bags)}`
                        : d.employee_type === 'factory_manager'
                        ? `Total bags out (finished inventory): ${fmtNum(d.bags)}`
                        : `Bags sold: ${fmtNum(d.bags)}`}
                      &nbsp;/&nbsp;Target: {fmtNum(d.monthlyTarget)} bags
                    </div>
                  </div>
                  {/* Performance % badge */}
                  <div className={'text-center px-4 py-2 rounded-xl '
                    + (d.pct >= 100 ? 'bg-green-100 text-green-700'
                    : d.pct >= 60  ? 'bg-orange-100 text-orange-700'
                    : 'bg-red-100 text-red-600')}>
                    <div className="text-xs font-medium">Performance</div>
                    <div className="text-xl font-bold tabular-nums">{d.pct.toFixed(1)}%</div>
                  </div>
                </div>

                {/* Pay breakdown */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {[
                    ['Base Pay Earned',  fmtGhc(d.earnedBase),  'd.pct>=100?"text-green-700":"text-orange-600"'],
                    ['Feeding Fee',      fmtGhc(d.feedingFee),  '"text-blue-700"'],
                    ['Gross Pay',        fmtGhc(d.total),       '"text-[#1F4E79] font-bold"'],
                    ['Losses Deducted',  fmtGhc(d.totalLosses), '"text-red-600"'],
                  ].map(([l, v]) => (
                    <div key={l as string} className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <div className="text-xs text-gray-500">{l}</div>
                      <div className="font-semibold text-sm mt-0.5 tabular-nums">{v}</div>
                    </div>
                  ))}
                </div>

                {/* Formula explanation */}
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 mb-3">
                  ({fmtNum(d.bags)} ÷ {fmtNum(d.monthlyTarget)}) × GHc {d.basePay.toLocaleString()} + GHc {d.feedingFee} feeding
                  = GHc {d.earnedBase.toFixed(2)} + GHc {d.feedingFee} = <strong>GHc {d.total.toFixed(2)}</strong>
                  {d.totalLosses > 0 && ` − GHc ${d.totalLosses.toFixed(2)} losses`}
                  = <strong>GHc {d.netPay.toFixed(2)} net</strong>
                </div>

                {/* Net pay + action */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="text-xs text-gray-500">NET PAY</div>
                    <div className={'text-2xl font-bold tabular-nums '
                      + (d.netPay > 0 ? 'text-[#1F4E79]' : 'text-gray-400')}>
                      {fmtGhc(d.netPay)}
                    </div>
                    {d.locked && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Paid on {d.lockInfo?.payment_date} · {fmtGhc(d.lockInfo?.amount)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="text-center">
                      <div className="text-xs text-gray-500">Net Pay</div>
                      <div className={'font-bold text-lg ' + (d.netPay > 0 ? 'text-[#1F4E79]' : 'text-red-600')}>{fmtGhc(d.netPay)}</div>
                    </div>
                    {d.locked
                      ? <div className="text-center"><div className="text-xs text-gray-400">Paid {d.lockInfo?.payment_date}</div><div className="badge badge-gray mt-1">LOCKED</div></div>
                      : d.netPay > 0
                      ? <button onClick={() => payEmployee(d)} className="btn btn-success">Pay Now</button>
                      : <div className="badge badge-gray">No Pay Due</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* LOSS REGISTER TAB */}
      {tab === 'losses' && (
        <div className="card">
          <table className="data-table">
            <colgroup>
            <col style={{width:'90px'}} /><col style={{width:'130px'}} />
            <col style={{width:'120px'}} /><col />
            <col style={{width:'105px'}} /><col style={{width:'75px'}} />
          </colgroup>
          <colgroup>
            <col style={{width:'90px'}} /><col style={{width:'120px'}} />
            <col style={{width:'110px'}} /><col />
            <col style={{width:'100px'}} /><col style={{width:'70px'}} /><col style={{width:'70px'}} />
          </colgroup>
          <thead><tr>
            <th>Date</th><th>Employee</th><th>Type</th>
            <th>Description</th><th className="right">Amount</th><th>Status</th><th>Actions</th>
          </tr></thead>
            <tbody>
              {losses.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No losses recorded</td></tr>
              : losses.map((l: any) => (
                <tr key={l.id}>
                  <td className="muted">{l.loss_date}</td>
                  <td className="text-sm font-medium">{l.employees?.full_name}</td>
                  <td><span className="badge badge-red">{l.loss_type}</span></td>
                  <td className="text-xs">{l.description}</td>
                  <td className="num-red">{fmtGhc(l.loss_amount)}</td>
                  <td><span className={'badge ' + (l.posted ? 'badge-green' : 'badge-yellow')}>{l.posted ? 'Posted' : 'Pending'}</span></td>
                  <td><button onClick={async () => {
                    if (!confirm('Delete this loss record?')) return
                    await supabase.from('employee_losses').delete().eq('id', l.id)
                    loadAll()
                  }} className="btn btn-sm btn-danger">Del</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SALARY PAYMENTS TAB */}
      {tab === 'salary' && (
        <div className="card">
          <table className="data-table">
            <colgroup>
            <col style={{width:'90px'}} /><col style={{width:'130px'}} />
            <col style={{width:'110px'}} /><col style={{width:'160px'}} />
            <col style={{width:'105px'}} /><col /><col style={{width:'70px'}} />
          </colgroup>
          <thead><tr>
            <th>Date</th><th>Employee</th><th>Type</th>
            <th>Period</th><th className="right">Amount</th><th>Notes</th><th>Actions</th>
          </tr></thead>
            <tbody>
              {salaryPay.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No salary payments</td></tr>
              : salaryPay.map((p: any) => (
                <tr key={p.id}>
                  <td className="muted">{fmtDate(p.payment_date)}</td>
                  <td className="font-medium">{p.employees?.full_name}</td>
                  <td><span className="badge badge-blue">{p.payment_type}</span></td>
                  <td className="muted">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                  <td className="num">{fmtGhc(p.amount)}</td>
                  <td className="muted">{p.notes||'—'}</td>
                  <td><button onClick={async () => {
                    if (!confirm('Delete this salary payment?')) return
                    await supabase.from('salary_payments').delete().eq('id', p.id)
                    loadAll()
                  }} className="btn btn-sm btn-danger">Del</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* EMPLOYEE FORM */}
      {showEmpForm && (
        <div className="modal-overlay" onClick={() => setShowEmpForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editEmp ? 'Edit Employee' : 'New Employee'}</h2>
              <button onClick={() => setShowEmpForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group col-span-2"><label className="form-label">Full Name *</label><input value={empForm.full_name} onChange={e=>setEmpForm(f=>({...f,full_name:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Role / Job Title *</label><input value={empForm.role} onChange={e=>setEmpForm(f=>({...f,role:e.target.value}))} className="form-input" placeholder="Sales Officer, Driver, Rider..." /></div>
                <div className="form-group">
                  <label className="form-label">Employee Type</label>
                  <select value={empForm.employee_type} onChange={e=>setEmpForm(f=>({...f,employee_type:e.target.value}))} className="form-select">
                    <option value="staff">Staff (General)</option>
                    <option value="rider">🛵 Rider / Sales Rep (sells to customers)</option>
                    <option value="factory_manager">🏭 Factory Manager (dispatches to riders)</option>
                  </select>
                  <div className="text-xs text-gray-400 mt-1">This controls what they see in the Sales module</div>
                </div>
                <div className="col-span-2 border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1">
                    Performance Pay — Target Viability
                  </div>
                  <div className="text-xs text-blue-500 mb-3">
                    Enter base pay and selling price → system auto-suggests a daily target.
                    Or enter a target manually to see the full financial breakdown.
                  </div>
                </div>

                {/* Pricing inputs row */}
                <div className="form-group">
                  <label className="form-label">Base Pay (GHc)</label>
                  <input type="number" step="0.01" value={empForm.base_pay}
                    onChange={e => setEmpForm(f => ({...f, base_pay: e.target.value}))}
                    className="form-input" placeholder="e.g. 1500" />
                  <div className="text-xs text-gray-400 mt-1">Proportional — scales with bags delivered</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Feeding Fee (GHc)</label>
                  <input type="number" step="0.01" value={empForm.feeding_fee}
                    onChange={e => setEmpForm(f => ({...f, feeding_fee: e.target.value}))}
                    className="form-input" placeholder="300" />
                  <div className="text-xs text-gray-400 mt-1">Always paid in full</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Selling Price per Bag (GHc)</label>
                  <input type="number" step="0.01" value={empForm.selling_price}
                    onChange={e => setEmpForm(f => ({...f, selling_price: e.target.value}))}
                    className="form-input" placeholder="e.g. 6.00" />
                  <div className="text-xs text-gray-400 mt-1">Used to calculate surplus per bag</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input value={empForm.phone}
                    onChange={e => setEmpForm(f => ({...f, phone: e.target.value}))}
                    className="form-input" />
                </div>

                {/* Smart target calculator */}
                {(() => {
                  const bp   = parseFloat(empForm.base_pay) || 0
                  const sp   = parseFloat(empForm.selling_price) || 0
                  const ff   = parseFloat(empForm.feeding_fee) || 0
                  const mt   = parseInt(empForm.monthly_target) || 0
                  const dt   = parseInt(empForm.sales_target_daily) || 0
                  const p    = PRICING

                  // Per-bag costs
                  const roll   = p.roll_cost_per_kg / p.bags_per_kg
                  const pkg    = p.pkg_bulk_cost / p.pkg_bulk_qty
                  const water  = p.water_cost_per_liter * p.liters_per_bag
                  const op     = p.operator_fee_per_100 / 100
                  const oh     = p.labor_per_bag + p.utility_per_bag + p.machine_per_bag
                  const perfEst = bp > 0 && mt > 0 ? bp / mt : 0
                  const totalCostPb = roll + pkg + water + op + oh + perfEst
                  const surplusPb   = sp - totalCostPb

                  // Auto-suggest: monthly target = base pay ÷ surplus per bag
                  const suggestedMonthly = surplusPb > 0 ? Math.ceil(bp / surplusPb) : 0
                  const suggestedDaily   = suggestedMonthly > 0
                    ? Math.ceil(suggestedMonthly / p.std_days) : 0

                  // Viability of current manual target
                  const usedMonthly = mt > 0 ? mt : dt * p.std_days
                  const riderRevenue = sp * usedMonthly
                  const riderCosts   = totalCostPb * usedMonthly
                  const riderSurplus = riderRevenue - riderCosts
                  const payRatio     = riderSurplus > 0 ? (bp / riderSurplus) * 100 : 0
                  const viable       = payRatio <= 100 && surplusPb > 0

                  const autoFillTarget = () => {
                    setEmpForm(f => ({
                      ...f,
                      monthly_target: String(suggestedMonthly),
                      sales_target_daily: String(suggestedDaily),
                    }))
                  }

                  return bp > 0 && sp > 0 ? (
                    <div className="col-span-2">
                      {/* Auto-suggestion */}
                      {suggestedDaily > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
                          <div className="text-xs font-semibold text-blue-700 mb-1">
                            💡 Suggested Target based on Base Pay ÷ Surplus per bag
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center mb-2">
                            {[
                              ['Surplus / bag', `${fmtGhc(surplusPb)}`, surplusPb > 0 ? 'text-green-700' : 'text-red-600'],
                              ['Monthly target', `${suggestedMonthly.toLocaleString()} bags`, 'text-[#1F4E79]'],
                              ['Daily target',   `${suggestedDaily} bags/day`,                'text-[#1F4E79]'],
                            ].map(([l,v,c]) => (
                              <div key={l as string} className="bg-white rounded-lg p-2">
                                <div className="text-xs text-gray-500">{l}</div>
                                <div className={'text-sm font-bold ' + c}>{v}</div>
                              </div>
                            ))}
                          </div>
                          <button type="button" onClick={autoFillTarget}
                            className="btn btn-primary btn-sm w-full">
                            ✅ Use this target ({suggestedDaily} bags/day)
                          </button>
                        </div>
                      )}
                      {surplusPb <= 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-xs text-red-700">
                          ❌ Selling price ({fmtGhc(sp)}) is below total cost per bag ({fmtGhc(totalCostPb)}).
                          No target can make this pay viable — increase selling price first.
                        </div>
                      )}
                    </div>
                  ) : null
                })()}

                {/* Target inputs */}
                <div className="form-group">
                  <label className="form-label">Monthly Bag Target</label>
                  <input type="number" value={empForm.monthly_target}
                    onChange={e => setEmpForm(f => ({
                      ...f, monthly_target: e.target.value,
                      sales_target_daily: String(Math.ceil((parseInt(e.target.value)||0) / 26))
                    }))}
                    className="form-input" placeholder="6500" />
                  <div className="text-xs text-gray-400 mt-1">
                    = {Math.ceil((parseInt(empForm.monthly_target)||0) / 26)} bags/day × 26 days
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Daily Bag Target</label>
                  <input type="number" value={empForm.sales_target_daily}
                    onChange={e => setEmpForm(f => ({
                      ...f, sales_target_daily: e.target.value,
                      monthly_target: String((parseInt(e.target.value)||0) * 26)
                    }))}
                    className="form-input" placeholder="250" />
                  <div className="text-xs text-gray-400 mt-1">
                    Synced with monthly target above
                  </div>
                </div>

                {/* Full viability breakdown */}
                {(() => {
                  const bp   = parseFloat(empForm.base_pay) || 0
                  const sp   = parseFloat(empForm.selling_price) || 0
                  const ff   = parseFloat(empForm.feeding_fee) || 0
                  const mt   = parseInt(empForm.monthly_target) || 0
                  if (bp <= 0 || sp <= 0 || mt <= 0) return null
                  const p    = PRICING
                  const roll   = p.roll_cost_per_kg / p.bags_per_kg
                  const pkg    = p.pkg_bulk_cost / p.pkg_bulk_qty
                  const water  = p.water_cost_per_liter * p.liters_per_bag
                  const op     = p.operator_fee_per_100 / 100
                  const oh     = p.labor_per_bag + p.utility_per_bag + p.machine_per_bag
                  const perfEst = bp / mt
                  const totalCostPb = roll + pkg + water + op + oh + perfEst
                  const surplusPb   = sp - totalCostPb
                  const revenue     = sp * mt
                  const totalCost   = totalCostPb * mt
                  const surplus     = surplusPb * mt
                  const payRatio    = surplus > 0 ? (bp / surplus) * 100 : Infinity
                  const dt          = parseInt(empForm.sales_target_daily) || Math.ceil(mt/26)
                  const verdict     = surplusPb <= 0 ? 'loss'
                    : payRatio > 100 ? 'unsustainable'
                    : payRatio > 80  ? 'tight' : 'viable'

                  return (
                    <div className="col-span-2">
                      <div className={'rounded-xl border p-4 '
                        + (verdict==='viable' ? 'bg-green-50 border-green-200'
                        : verdict==='tight'   ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-red-50 border-red-200')}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">
                            {verdict==='viable'?'✅':verdict==='tight'?'⚠️':'❌'}
                          </span>
                          <span className={'font-bold text-sm '
                            + (verdict==='viable'?'text-green-700':verdict==='tight'?'text-yellow-700':'text-red-700')}>
                            {verdict==='viable' ? 'Target is viable'
                            : verdict==='tight'  ? 'Target is tight — base pay consumes >80% of surplus'
                            : verdict==='unsustainable' ? 'Unsustainable — base pay exceeds available surplus'
                            : 'Loss-making — selling price below total cost'}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                          Monthly breakdown at {mt.toLocaleString()} bags ({dt} bags/day)
                        </div>

                        <div className="space-y-1.5">
                          {[
                            ['Rider Revenue (bags × price)',    revenue,           'text-green-700'],
                            ['Roll Film cost',                  -(roll * mt),      'text-red-600'],
                            ['Packaging Bags cost',             -(pkg * mt),       'text-red-600'],
                            ['Water cost',                      -(water * mt),     'text-red-600'],
                            ['Operator Fee',                    -(op * mt),        'text-orange-600'],
                            ['Overhead (labor+elec+machine)',   -(oh * mt),        'text-orange-600'],
                            ['Est. Base Pay (cost)',            -bp,               'text-purple-600'],
                            ['Feeding Fee',                     -ff,               'text-purple-600'],
                          ].map(([l,v,c]) => (
                            <div key={l as string} className="flex justify-between text-xs">
                              <span className="text-gray-600">{l}</span>
                              <span className={'font-medium tabular-nums ' + c}>
                                {(v as number) < 0 ? `−${fmtGhc(Math.abs(v as number))}` : fmtGhc(v as number)}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-gray-200 pt-1.5 mt-1">
                            <div className="flex justify-between text-xs font-bold">
                              <span>Company Net Surplus after all costs</span>
                              <span className={surplusPb * mt - ff >= 0 ? 'text-green-700' : 'text-red-700'}>
                                {fmtGhc(surplus - ff)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                              <span>Base pay as % of generated surplus</span>
                              <span className={payRatio <= 80 ? 'text-green-600' : payRatio <= 100 ? 'text-yellow-600' : 'text-red-600'}>
                                {isFinite(payRatio) ? payRatio.toFixed(1) + '%' : '∞'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="form-group">
                  <label className="form-label">Monthly Salary (GHc)</label>
                  <input type="number" value={empForm.salary}
                    onChange={e => setEmpForm(f => ({...f, salary: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Working Days/Week</label>
                  <input type="number" value={empForm.working_days}
                    onChange={e => setEmpForm(f => ({...f, working_days: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Hire Date</label>
                  <input type="date" value={empForm.hire_date}
                    onChange={e => setEmpForm(f => ({...f, hire_date: e.target.value}))}
                    className="form-input" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowEmpForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveEmployee} disabled={!empForm.full_name} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* LOSS FORM */}
      {showLossForm && (
        <div className="modal-overlay" onClick={() => setShowLossForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">Record Loss</h2>
              <button onClick={() => setShowLossForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group"><label className="form-label">Employee *</label>
                  <select value={lossForm.employee_id} onChange={e=>setLossForm(f=>({...f,employee_id:e.target.value}))} className="form-select">
                    <option value="">Select...</option>
                    {employees.filter((e:any)=>e.status==='active').map((e:any)=><option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label">Date</label><input type="date" value={lossForm.loss_date} onChange={e=>setLossForm(f=>({...f,loss_date:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Loss Type</label>
                  <select value={lossForm.loss_type} onChange={e=>setLossForm(f=>({...f,loss_type:e.target.value}))} className="form-select">
                    {LOSS_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select></div>
                <div className="form-group col-span-2"><label className="form-label">Description *</label><input value={lossForm.description} onChange={e=>setLossForm(f=>({...f,description:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Quantity</label><input type="number" value={lossForm.quantity} onChange={e=>setLossForm(f=>({...f,quantity:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Unit Cost (GHc)</label><input type="number" step="0.01" value={lossForm.unit_cost} onChange={e=>setLossForm(f=>({...f,unit_cost:e.target.value}))} className="form-input" /></div>
                {lossForm.quantity && lossForm.unit_cost && (
                  <div className="col-span-2 bg-red-50 rounded p-2 text-center text-sm">
                    Loss Amount: <strong className="text-red-700">{fmtGhc(parseFloat(lossForm.quantity||'0') * parseFloat(lossForm.unit_cost||'0'))}</strong>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowLossForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveLoss} disabled={!lossForm.employee_id||!lossForm.description} className="btn btn-danger">Record Loss</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function PersonnelPage() {
  return (
    <ModuleGuard moduleKey="personnel" moduleLabel="Personnel">
      <PersonnelPageInner />
    </ModuleGuard>
  )
}
