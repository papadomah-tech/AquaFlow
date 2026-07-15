export interface AppModule {
  key:   string
  label: string
  icon:  string
  href:  string
  adminOnly:   boolean
  description: string
}

export const ALL_MODULES: AppModule[] = [
  { key: 'dashboard',      label: 'Dashboard',      icon: '📊', href: '/dashboard',      adminOnly: false, description: 'Business overview, revenue stats, recent sales' },
  { key: 'raw-materials',  label: 'Raw Materials',  icon: '🧱', href: '/raw-materials',  adminOnly: false, description: 'Stock levels, roll film inventory, purchases' },
  { key: 'production',     label: 'Production',     icon: '🏭', href: '/production',     adminOnly: false, description: 'Production batches, batch history, operator fees' },
  { key: 'stock',          label: 'Stock',          icon: '📦', href: '/stock',          adminOnly: false, description: 'Finished goods ledger, stock take, movements' },
  { key: 'pricing',        label: 'Pricing',        icon: '💰', href: '/pricing',        adminOnly: false, description: 'Cost calculator, revenue breakdown' },
  { key: 'customers',      label: 'Customers',      icon: '👤', href: '/customers',      adminOnly: false, description: 'Customer base — add, search, manage contacts' },
  { key: 'rider-sales',    label: 'My Sales',       icon: '🛵', href: '/rider-sales',    adminOnly: false, description: 'Personal sales diary — deliveries, collections, outstanding' },
  { key: 'sales',          label: 'Sales',          icon: '💼', href: '/sales',          adminOnly: false, description: 'Sales records, customers, payments' },
  { key: 'expenses',       label: 'Expenses',       icon: '💸', href: '/expenses',       adminOnly: false, description: 'Record and manage all expenses' },
  { key: 'reconciliation', label: 'Cash Book',       icon: '📒', href: '/reconciliation', adminOnly: false, description: 'Cash receipts and payments — closing balance = cash on hand' },
  { key: 'bank-rec',       label: 'Bank Rec.',       icon: '🏦', href: '/bank-rec',       adminOnly: true,  description: 'Bank reconciliation — system deposits vs bank statement balance' },
  { key: 'personnel',      label: 'Personnel',      icon: '👥', href: '/personnel',      adminOnly: false, description: 'Employees, performance pay, losses' },
  { key: 'reports',        label: 'Reports',        icon: '📈', href: '/reports',        adminOnly: false, description: 'P&L, salesperson reports, financial analysis' },
  { key: 'weekly-report',    label: 'Deposit Report',   icon: '📅', href: '/weekly-report',  adminOnly: false, description: 'Monthly deposit report segregated by week' },
  { key: 'fund-segregation', label: 'Fund Segregation', icon: '💰', href: '/fund-segregation', adminOnly: false, description: 'Ring-fence cost components and track available funds' },
  { key: 'performance',    label: 'Performance Pay', icon: '📊', href: '/performance',   adminOnly: false, description: 'Calculate and pay performance-based salaries' },
  { key: 'imprest',        label: 'Imprest',        icon: '🧾', href: '/imprest',        adminOnly: false, description: 'Petty cash float — advances and expense reconciliation' },
  { key: 'sales-account',  label: 'Sales Account',  icon: '📋', href: '/sales-account',  adminOnly: false, description: 'Per-user sales account — bags, earnings, factory debt' },
  { key: 'fund-account',   label: 'Deposits Account', icon: '💰', href: '/fund-account',   adminOnly: true,  description: 'Company fund — deposits, rider payments, expenses (admin only)' },
  { key: 'setup',          label: 'Setup / Opening Bal.', icon: '🚀', href: '/setup',          adminOnly: true,  description: 'Set up opening balances before going live' },
  { key: 'import',         label: 'Import Data',    icon: '📥', href: '/import',         adminOnly: true,  description: 'Import customers, employees, expenses from CSV' },
  { key: 'settings',       label: 'Settings',       icon: '⚙️', href: '/settings',       adminOnly: true,  description: 'User management and permissions (admin only)' },
]

export const ADMIN_ALWAYS: string[]     = ['dashboard', 'settings']
export const DEFAULT_PERMISSIONS: string[] = ['customers']
