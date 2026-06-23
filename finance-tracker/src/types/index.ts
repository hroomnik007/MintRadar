// ── Local frontend types (mapped from API) ──────────────────────────────────

export interface Category {
  id?: string
  name: string
  color: string
  icon: string
  budgetLimit?: number
  autoLimit?: boolean
  hasFixedExpenses?: boolean
  type: 'income' | 'expense'
}

export interface Income {
  id?: string
  amount: number
  label: string
  date: string
  recurring: boolean
  created_by?: string | null
}

export interface FixedExpense {
  id?: string
  label: string
  amount: number
  dayOfMonth: number
  categoryId?: string | null
  note: string
}

export interface VariableExpense {
  id?: string
  amount: number
  categoryId: string
  note: string
  date: string
  created_by?: string | null
}

export interface AppSetting {
  key: string
  value: string | number | boolean
}

export interface AppSettings {
  currency: string
  language: string
  dateFormat: string
  firstDayOfWeek: string
  firstDayOfMonth?: number
  defaultPage?: string
  currencyFormat?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'EUR',
  language: '',
  dateFormat: 'DD.MM.YYYY',
  firstDayOfWeek: 'monday',
  firstDayOfMonth: 1,
  defaultPage: 'dashboard',
  currencyFormat: 'sk',
}

export interface BudgetStatus {
  categoryId: string
  categoryName: string
  categoryIcon: string
  categoryColor: string
  spent: number
  limit: number
  percentage: number
  isWarning: boolean
  isOver: boolean
}

// ── API types (raw backend responses) ───────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  name: string
  avatarUrl?: string | null
  role?: string
  weeklyEmailEnabled?: boolean
  monthlyEmailEnabled?: boolean
  onboardingComplete?: boolean
  currentStreak?: number
  longestStreak?: number
  badges?: string[]
  createdAt?: string
  defaultPage?: string
  currencyFormat?: string
  theme?: string
  household_id?: number | null
  household_enabled?: boolean
  savings_enabled?: boolean
  tracking_start_date?: string | null
  onboarding_banner_dismissed?: boolean
  has_pin?: boolean
  language?: string | null
  isDemo?: boolean
  phone?: string | null
  country?: string | null
  auto_lock_minutes?: number | null
  household?: {
    id: number
    name: string
    invite_code: string
  } | null
}

export interface ApiCategory {
  id: string
  userId: string
  name: string
  type: 'income' | 'expense'
  color: string | null
  icon: string | null
  isDefault: boolean
  createdAt: string
  budgetLimit?: number | null
  autoLimit?: boolean
  hasFixedExpenses?: boolean
}

export interface ApiTransaction {
  id: string
  userId: string
  categoryId: string | null
  type: 'income' | 'expense'
  amount: number
  description: string | null
  date: string
  isFixed: boolean
  createdAt: string
  updatedAt: string
  categoryName: string | null
  categoryColor: string | null
  categoryIcon: string | null
  created_by?: string | null
  household_id?: number | null
}

export interface Deposit {
  id: string
  amount: number
  date: string
}

export interface ApiSavingsGoal {
  id: string
  userId: string
  name: string
  targetAmount: number
  savedAmount: number
  deadline: string | null
  icon: string | null
  color: string | null
  note: string | null
  paused: boolean
  createdAt: string
  updatedAt: string
}

export interface SavingsGoal {
  id?: string
  name: string
  targetAmount: number
  savedAmount: number
  deadline?: string | null
  icon?: string
  color?: string
  note?: string
  paused?: boolean
}

export interface UserSession {
  id: string
  userId: string
  deviceName: string | null
  browser: string | null
  ip: string | null
  location: string | null
  lastActive: string
  createdAt: string
}

export interface ApiSummary {
  totalIncome: number
  totalExpenses: number
  balance: number
  byCategory: Array<{
    categoryId: string | null
    name: string
    color: string
    type: 'income' | 'expense'
    total: number
    percentage: number
  }>
}
