export type UserRole = 'super_admin' | 'admin' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
}

export interface IncomeRecord {
  id: string;
  date: string;
  name: string;
  amount: number;
  method: 'Bikash' | 'Nagad' | 'Cash' | 'Bank';
  paymentNumber?: string;
  comment?: string;
  createdBy: string;
}

export interface ExpenseRecord {
  id: string;
  date: string;
  category: string;
  amount: number;
  voucherUrl?: string;
  createdBy: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  number: string;
  type: string;
}
