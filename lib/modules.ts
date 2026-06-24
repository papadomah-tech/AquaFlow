export interface AppModule {
  key:   string
  label: string
  icon:  string
  href:  string
  adminOnly: boolean
  description: string
}

export const ALL_MODULES: AppModule[] = [
  { key: 'dashboard',      label: 'Dashboard',       icon: '📊', href: '/dashboard',      adminOnly: true,  description: 'Business overview, revenue stats, recent sales' },
  { key: 'raw-materials',  label: 'Raw Materials',   icon: '🧱', href: '/raw-materials',  adminOnly: false, description: 'Stock levels, roll film inventory, purchases' },
  { key: 'production',     label: 'Production',      icon: '🏭', href: '/production',     adminOnly: false, description: 'Production batches, batch history, operator fees' },
  { key: 'stock',          label: 'Stock',           icon: '📦', href: '/stock',          adminOnly: false, description: 'Finished goods ledger, stock take, movements' },
  { key: 'pricing',        label: 'Pricing',         icon: '💰', href: '/pricing',        adminOnly: false, description: 'Cost calculator, revenue breakdown' },
  { key: 'sales',          label: 'Sales',           icon: '💼', href: '/sales',          adminOnly: false, description: 'Sales records, customers, payments' },
  { key: 'expenses',       label: 'Expenses',        icon: '💸', href: '/expenses',       adminOnly: false, description: 'Record and manage all expenses' },
  { key: 'reconciliation', label: 'Cash & Bank',     icon: '🏦', href: '/reconciliation', adminOnly: false, description: 'Bank reconciliation, deposits' },
  { key: 'personnel',      label: 'Personnel',       icon: '👥', href: '/personnel',      adminOnly: false, description: 'Employees, performance pay, losses' },
  { key: 'reports',        label: 'Reports',         icon: '📈', href: '/reports',        adminOnly: false, description: 'P&L, salesperson reports, financial analysis' },
  { key: 'settings',       label: 'Settings',        icon: '⚙️', href: '/settings',       adminOnly: true,  description: 'User management and permissions (admin only)' },
]

// Modules an admin always has access to
export const ADMIN_ALWAYS: string[] = ['dashboard', 'settings']

// Default modules for a new non-admin user
export const DEFAULT_PERMISSIONS: string[] = ['sales']
