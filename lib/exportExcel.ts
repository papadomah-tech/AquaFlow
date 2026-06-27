// Simple CSV export (opens in Excel)
// No external library needed — CSV is natively supported by Excel

export function exportToCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows || rows.length === 0) {
    alert('No data to export.')
    return
  }
  const headers = Object.keys(rows[0])
  const csvRows = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h] ?? ''
        const str = String(val)
        // Wrap in quotes if contains comma, quote or newline
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? '"' + str.replace(/"/g, '""') + '"'
          : str
      }).join(',')
    )
  ]
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename + '_' + new Date().toISOString().split('T')[0] + '.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function exportSalesToCSV(sales: any[], filename = 'sales_report') {
  const rows = sales.map(s => ({
    Date:         s.sale_date,
    Type:         s.sale_type === 'bulk' ? 'Bulk Dispatch' : 'Retail Sale',
    Customer:     s.customers?.name ?? s.buyer?.full_name ?? '—',
    'Sales Rep':  s.employees?.full_name ?? '—',
    'Bags Sold':  s.bags_sold,
    'Unit Price': s.unit_price,
    'Total (GHc)':        s.total_amount,
    'Amount Paid (GHc)':  s.amount_paid,
    'Balance (GHc)':      s.outstanding_balance,
    Status:       s.payment_status,
    Notes:        s.notes ?? '',
  }))
  exportToCSV(filename, rows)
}

export function exportExpensesToCSV(expenses: any[], filename = 'expenses_report') {
  const rows = expenses.map(e => ({
    Date:        e.expense_date,
    Category:    e.category,
    Description: e.description,
    'Amount (GHc)': e.amount,
    'Paid To':   e.paid_to ?? '—',
  }))
  exportToCSV(filename, rows)
}

export function exportDepositsToCSV(deposits: any[], filename = 'deposits_report') {
  const rows = deposits.map(d => ({
    Date:            d.deposit_date,
    'Bank/Account':  d.bank_name,
    Reference:       d.reference ?? '—',
    'Deposited By':  d.deposited_by ?? '—',
    'Amount (GHc)':  d.amount,
    Notes:           d.notes ?? '',
  }))
  exportToCSV(filename, rows)
}

export function exportSalesAccountToCSV(data: any, empName: string) {
  // Sheet 1: Summary
  const summary = [
    { Section: 'BAG POSITION', Item: 'Total Received (from factory)', Value: data.bagsReceived },
    { Section: 'BAG POSITION', Item: 'Total Sold (retail)', Value: data.bagsSoldAll },
    { Section: 'BAG POSITION', Item: 'On Hand', Value: data.bagsOnHand },
    { Section: 'FACTORY ACCOUNT', Item: 'Total Bags Value (bulk price)', Value: data.totalOwed },
    { Section: 'FACTORY ACCOUNT', Item: 'Total Paid to Factory', Value: data.totalPaidFactory },
    { Section: 'FACTORY ACCOUNT', Item: 'Outstanding Balance Owed', Value: data.owedToFactory },
    { Section: 'RETAIL EARNINGS', Item: 'Total Revenue', Value: data.retailRevenue },
    { Section: 'RETAIL EARNINGS', Item: 'Cash Collected', Value: data.retailCollected },
    { Section: 'RETAIL EARNINGS', Item: 'Outstanding from Customers', Value: data.retailOutstanding },
    { Section: 'RETAIL EARNINGS', Item: 'Gross Profit', Value: data.grossProfit },
  ]
  exportToCSV('sales_account_' + empName.replace(/\s+/g,'_'), summary)
}
