export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer'
export type PaymentStatus = 'paid' | 'partial' | 'unpaid'
export type RollStatus = 'available' | 'in_use' | 'finished'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface RawMaterial {
  id: number; name: string; unit: string
  current_stock: number; low_stock_threshold: number; created_at: string
}

export interface RollFilm {
  id: number; label: string; weight_kg: number
  purchase_date?: string; supplier?: string; cost: number
  bags_expected: number; bags_produced: number
  status: RollStatus; notes?: string; created_at: string
}

export interface ProductionBatch {
  id: number; batch_date: string; batch_number: string
  roll_film_id?: number; roll_ref?: string
  roll_kg_used: number; bags_consumed: number
  water_used: number; bags_produced: number
  yield_ratio: number; notes?: string
  created_by?: string; created_at: string
  roll_films?: RollFilm
}

export interface Customer {
  id: number; name: string; phone?: string
  email?: string; address?: string
  default_rep_id?: number; created_at: string
}

export interface Employee {
  id: number; full_name: string; role: string
  phone?: string; email?: string; address?: string
  salary: number; sales_target_daily: number; working_days: number
  hire_date: string; status: string
  perf_group_id?: number; is_bag_source?: boolean
  rider_topup?: boolean; team_role?: string; created_at: string
}

export interface Sale {
  id: number; sale_date: string
  customer_id: number; salesperson_id?: number
  bags_sold: number; protocol_bags: number
  unit_price: number; total_amount: number
  amount_paid: number; outstanding_balance: number
  payment_status: PaymentStatus; notes?: string
  created_by?: string; created_at: string
  customers?: Customer; employees?: Employee
}

export interface Payment {
  id: number; sale_id: number; payment_date: string
  amount: number; payment_method: string
  reference?: string; notes?: string; created_at: string
}

export interface Expense {
  id: number; expense_date: string; category: string
  description: string; amount: number
  paid_to?: string; created_by?: string; created_at: string
}

export interface BankDeposit {
  id: number; deposit_date: string; bank_name: string
  account_number?: string; amount: number
  reference?: string; deposited_by?: string
  notes?: string; created_by?: string; created_at: string
}

export interface FinishedInventory {
  id: number; bags_in: number; bags_out: number
  transaction_date: string; reference_type?: string
  sale_id?: number; notes?: string; created_at: string
}

export interface StockTake {
  id: number; take_date: string; taken_by?: number
  notes?: string; status: string; created_at: string
  stock_take_items?: StockTakeItem[]
}

export interface StockTakeItem {
  id: number; stock_take_id: number; item_type: string
  item_id?: number; item_name: string; unit?: string
  system_qty: number; counted_qty: number; variance: number
  responsible_emp_id?: number; deduction_amount: number
  deduction_posted: boolean; notes?: string
}

export interface EmployeeLoss {
  id: number; employee_id: number; loss_date: string
  loss_type: string; description: string
  quantity: number; unit: string; unit_cost: number
  loss_amount: number; source_ref?: string
  posted: boolean; posted_date?: string; notes?: string
  created_at: string; employees?: Employee
}

export interface SalaryPayment {
  id: number; employee_id: number; payment_date: string
  amount: number; payment_type: string
  period_start?: string; period_end?: string
  notes?: string; created_at: string; employees?: Employee
}
