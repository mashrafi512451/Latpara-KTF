import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  getDoc,
  setDoc,
  runTransaction,
  increment,
  updateDoc,
  FirestoreError
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { IncomeRecord, ExpenseRecord, UserProfile, UserRole, PaymentMethod } from './types';
import { 
  LayoutDashboard, 
  PlusCircle, 
  LogOut, 
  LogIn, 
  TrendingUp, 
  TrendingDown, 
  Wallet,
  Trash2,
  Lock,
  Menu,
  X,
  Users,
  ChevronRight,
  Copy,
  CreditCard,
  Check,
  Search,
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { AlertCircle } from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong. Please try refreshing the page.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error.includes("permission-denied")) {
          displayMessage = "You don't have permission to perform this action or view this data.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-4 border border-rose-100">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Application Error</h2>
            <p className="text-slate-600 text-sm leading-relaxed">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [income, setIncome] = useState<IncomeRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [stats, setStats] = useState({ income: 0, expense: 0, balance: 0 });
  const [appSettings, setAppSettings] = useState<{ showAmountsToPublic: boolean }>({ showAmountsToPublic: true });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'public' | 'admin'>('public');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          // Try fetching by UID first
          let userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          
          // If not found, try fetching by email (pre-authorized)
          if (!userDoc.exists() && currentUser.email) {
            userDoc = await getDoc(doc(db, 'users', currentUser.email));
          }

          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            setUserProfile({ ...data, uid: currentUser.uid }); // Ensure UID is correct
          } else if (currentUser.email === 'mashrafi512451@gmail.com') {
            // Default Super Admin
            setUserProfile({
              uid: currentUser.uid,
              email: currentUser.email || '',
              role: 'super_admin',
              displayName: currentUser.displayName || 'Super Admin'
            });
          } else {
            // Default to viewer to avoid permission errors on admin-only collections
            setUserProfile({
              uid: currentUser.uid,
              email: currentUser.email || '',
              role: 'viewer',
              displayName: currentUser.displayName || 'Guest'
            });
          }
        } catch (error) {
          console.error("Profile fetch error:", error);
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Data Listeners
  useEffect(() => {
    // Stats Listener (Public)
    const unsubscribeStats = onSnapshot(doc(db, 'stats', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setStats({
          income: data.income || 0,
          expense: data.expense || 0,
          balance: (data.income || 0) - (data.expense || 0)
        });
      }
    }, (error) => {
      console.error("Stats fetch error:", error);
      handleFirestoreError(error, OperationType.GET, 'stats/main');
    });

    // Income Listener (Public for names, Admin for amounts)
    const qIncome = query(collection(db, 'income'), orderBy('date', 'desc'));
    const unsubscribeIncome = onSnapshot(qIncome, (snapshot) => {
      setIncome(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IncomeRecord)));
    }, (error) => {
      console.error("Income fetch error:", error);
      handleFirestoreError(error, OperationType.LIST, 'income');
    });

    // Expenses Listener (Public)
    const qExpenses = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsubscribeExpenses = onSnapshot(qExpenses, (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseRecord)));
    }, (error) => {
      console.error("Expenses fetch error:", error);
      handleFirestoreError(error, OperationType.LIST, 'expenses');
    });

    // Payment Methods Listener (Public)
    const unsubscribePayments = onSnapshot(collection(db, 'settings'), (snapshot) => {
      setPaymentMethods(snapshot.docs
        .filter(doc => doc.id !== 'app')
        .map(doc => ({ id: doc.id, ...doc.data() } as PaymentMethod))
      );
    }, (error) => {
      console.error("Settings fetch error:", error);
      handleFirestoreError(error, OperationType.LIST, 'settings');
    });

    // App Settings Listener (Public)
    const unsubscribeAppSettings = onSnapshot(doc(db, 'settings', 'app'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as { showAmountsToPublic: boolean };
        console.log("App Settings Updated:", data);
        setAppSettings(data);
      }
    }, (error) => {
      console.error("App settings fetch error:", error);
    });

    return () => {
      unsubscribeStats();
      unsubscribeIncome();
      unsubscribeExpenses();
      unsubscribePayments();
      unsubscribeAppSettings();
    };
  }, [userProfile]);

  const totals = useMemo(() => {
    // For admins, we can calculate from local state for accuracy
    // For public, we use the stats document
    if (userProfile && (userProfile.role === 'admin' || userProfile.role === 'super_admin')) {
      const totalIncome = income.reduce((sum, item) => sum + item.amount, 0);
      const totalExpense = expenses.reduce((sum, item) => sum + item.amount, 0);
      return {
        income: totalIncome,
        expense: totalExpense,
        balance: totalIncome - totalExpense
      };
    }
    return stats;
  }, [income, expenses, stats, userProfile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const toggleAmountVisibility = async () => {
    try {
      await setDoc(doc(db, 'settings', 'app'), {
        showAmountsToPublic: !appSettings.showAmountsToPublic
      }, { merge: true });
    } catch (error) {
      console.error("Error updating settings:", error);
      handleFirestoreError(error, OperationType.WRITE, 'settings/app');
    }
  };

  const handleDeleteIncome = async (id: string, amount: number) => {
    try {
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', 'main');
        transaction.update(statsRef, { income: increment(-amount) });
        transaction.delete(doc(db, 'income', id));
      });
    } catch (error) {
      console.error("Delete income error:", error);
      handleFirestoreError(error, OperationType.WRITE, `income/${id}`);
    }
  };

  const handleDeleteExpense = async (id: string, amount: number) => {
    try {
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', 'main');
        transaction.update(statsRef, { expense: increment(-amount) });
        transaction.delete(doc(db, 'expenses', id));
      });
    } catch (error) {
      console.error("Delete expense error:", error);
      handleFirestoreError(error, OperationType.WRITE, `expenses/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-trust-green-light">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-trust-green"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-trust-green p-2 rounded-lg">
                <LayoutDashboard className="text-white w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold text-trust-green-dark hidden sm:block">
                Latpara Kalyan Trust
              </h1>
            </div>

            <div className="hidden md:flex items-center gap-6">
              <button 
                onClick={() => setActiveTab('public')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'public' ? 'text-trust-green border-b-2 border-trust-green' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Public View
              </button>
              {userProfile && (userProfile.role === 'admin' || userProfile.role === 'super_admin') && (
                <button 
                  onClick={() => setActiveTab('admin')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'admin' ? 'text-trust-green border-b-2 border-trust-green' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Admin Dashboard
                </button>
              )}
              {user ? (
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500 hidden lg:block">
                    Logged in as <span className="font-semibold text-slate-700">{user.email}</span>
                  </span>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all text-sm font-medium"
                  >
                    <LogOut size={16} /> Logout
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="flex items-center gap-2 px-6 py-2 rounded-full bg-trust-green text-white hover:bg-trust-green-dark transition-all text-sm font-medium shadow-md"
                >
                  <LogIn size={16} /> Admin Login
                </button>
              )}
            </div>

            <div className="md:hidden">
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-500">
                {isMobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </div>
        
        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-white border-t border-slate-100 overflow-hidden"
            >
              <div className="px-4 py-4 space-y-2">
                <button onClick={() => { setActiveTab('public'); setIsMobileMenuOpen(false); }} className="block w-full text-left px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg">Public View</button>
                {userProfile && (userProfile.role === 'admin' || userProfile.role === 'super_admin') && <button onClick={() => { setActiveTab('admin'); setIsMobileMenuOpen(false); }} className="block w-full text-left px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg">Admin Dashboard</button>}
                {!user ? (
                  <button onClick={handleLogin} className="w-full mt-4 bg-trust-green text-white py-3 rounded-lg flex items-center justify-center gap-2 font-medium">
                    <LogIn size={18} /> Login
                  </button>
                ) : (
                  <button onClick={handleLogout} className="w-full mt-4 bg-slate-100 text-slate-700 py-3 rounded-lg flex items-center justify-center gap-2 font-medium">
                    <LogOut size={18} /> Logout
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'public' ? (
          <PublicView 
            totals={totals} 
            expenses={expenses} 
            income={income} 
            userProfile={userProfile} 
            paymentMethods={paymentMethods}
            appSettings={appSettings}
          />
        ) : (
          <AdminView 
            userProfile={userProfile} 
            income={income} 
            expenses={expenses} 
            totals={totals}
            paymentMethods={paymentMethods}
            appSettings={appSettings}
            onToggleVisibility={toggleAmountVisibility}
            onDeleteIncome={handleDeleteIncome}
            onDeleteExpense={handleDeleteExpense}
          />
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-sm">© {new Date().getFullYear()} Latpara Kalyan Trust. All rights reserved.</p>
        </div>
      </footer>
    </div>
    </ErrorBoundary>
  );
}

function PublicView({ totals, expenses, income, userProfile, paymentMethods, appSettings }: { 
  totals: any, 
  expenses: ExpenseRecord[], 
  income: IncomeRecord[],
  userProfile: UserProfile | null,
  paymentMethods: PaymentMethod[],
  appSettings: { showAmountsToPublic: boolean }
}) {
  const isAdmin = userProfile && (userProfile.role === 'admin' || userProfile.role === 'super_admin');
  const showAmounts = isAdmin || appSettings.showAmountsToPublic;
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredIncome = income.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-10">
      {/* Hero Section */}
      <section className="text-center space-y-4 py-6">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Financial Transparency Dashboard
        </h2>
        <p className="text-slate-500 max-w-2xl mx-auto">
          Real-time tracking of trust funds and expenditures to maintain absolute transparency with our community.
        </p>
        <div className="pt-4">
          <button 
            onClick={() => setShowDonateModal(true)}
            className="px-8 py-3 bg-trust-green text-white rounded-full font-bold hover:bg-trust-green-dark transition-all shadow-lg shadow-emerald-100 flex items-center gap-2 mx-auto"
          >
            <CreditCard size={20} /> Donate Now
          </button>
        </div>
      </section>

      {/* Payment Methods Modal */}
      <AnimatePresence>
        {showDonateModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="bg-trust-green px-6 py-4 flex justify-between items-center text-white">
                <h3 className="font-bold flex items-center gap-2">
                  <CreditCard size={20} /> Payment Methods & Info
                </h3>
                <button onClick={() => setShowDonateModal(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-500">Please use the numbers below to send your donation:</p>
                  <div className="grid gap-3">
                    {paymentMethods.length > 0 ? paymentMethods.map((method) => (
                      <div key={method.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 group">
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase">{method.name} ({method.type})</p>
                          <p className="text-lg font-mono font-bold text-slate-800">{method.number}</p>
                        </div>
                        <button 
                          onClick={() => handleCopy(method.number)}
                          className={`p-2 rounded-lg transition-all ${copied === method.number ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-400 hover:text-trust-green shadow-sm'}`}
                        >
                          {copied === method.number ? <Check size={18} /> : <Copy size={18} />}
                        </button>
                      </div>
                    )) : (
                      <p className="text-center py-4 text-slate-400 italic">No payment methods available.</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Scorecard 
          title="Total Collection" 
          amount={showAmounts ? totals.income : 0} 
          icon={<TrendingUp className="text-emerald-600" />} 
          color="bg-emerald-50"
          textColor="text-emerald-700"
          hideAmount={!showAmounts}
        />
        <Scorecard 
          title="Total Expenditure" 
          amount={showAmounts ? totals.expense : 0} 
          icon={<TrendingDown className="text-rose-600" />} 
          color="bg-rose-50"
          textColor="text-rose-700"
          hideAmount={!showAmounts}
        />
        <Scorecard 
          title="Net Balance" 
          amount={showAmounts ? totals.balance : 0} 
          icon={<Wallet className="text-trust-green" />} 
          color="bg-trust-green-light"
          textColor="text-trust-green-dark"
          hideAmount={!showAmounts}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Donor List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-emerald-50/30">
            <h3 className="font-bold text-emerald-800 flex items-center gap-2">
              <Users size={18} /> Honorable Donors
            </h3>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Search donors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-1.5 bg-white border border-slate-200 rounded-full text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>
              <button className="p-2 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors shadow-sm">
                <Search size={16} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Donor Name</th>
                  {showAmounts && <th className="px-6 py-4 font-semibold text-right">Amount</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncome.length > 0 ? filteredIncome.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(item.date), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{item.name}</td>
                    {showAmounts && <td className="px-6 py-4 text-sm font-bold text-emerald-600 text-right">৳{item.amount.toLocaleString()}</td>}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={showAmounts ? 3 : 2} className="px-6 py-12 text-center text-slate-400 italic">No donor records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expense Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50/30">
            <h3 className="font-bold text-rose-800 flex items-center gap-2">
              <TrendingDown size={18} /> Recent Expenditures
            </h3>
            <span className="text-xs font-medium text-rose-600 uppercase tracking-wider">Public Record</span>
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Purpose</th>
                  {showAmounts && <th className="px-6 py-4 font-semibold text-right">Amount</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.length > 0 ? expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(exp.date), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{exp.category}</td>
                    {showAmounts && <td className="px-6 py-4 text-sm font-bold text-rose-600 text-right">৳{exp.amount.toLocaleString()}</td>}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={showAmounts ? 3 : 2} className="px-6 py-12 text-center text-slate-400 italic">No records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminView({ userProfile, income, expenses, totals, paymentMethods, appSettings, onToggleVisibility, onDeleteIncome, onDeleteExpense }: { 
  userProfile: UserProfile | null, 
  income: IncomeRecord[], 
  expenses: ExpenseRecord[],
  totals: any,
  paymentMethods: PaymentMethod[],
  appSettings: { showAmountsToPublic: boolean },
  onToggleVisibility: () => void,
  onDeleteIncome: (id: string, amount: number) => void,
  onDeleteExpense: (id: string, amount: number) => void
}) {
  const [showForm, setShowForm] = useState<'income' | 'expense' | 'admin' | 'settings' | null>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [incomeSearchTerm, setIncomeSearchTerm] = useState('');
  const [expenseSearchTerm, setExpenseSearchTerm] = useState('');

  if (!userProfile || (userProfile.role !== 'admin' && userProfile.role !== 'super_admin')) return null;

  const filteredIncome = income.filter(item => 
    item.name.toLowerCase().includes(incomeSearchTerm.toLowerCase())
  );

  const filteredExpenses = expenses.filter(item => 
    item.category.toLowerCase().includes(expenseSearchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Admin Dashboard</h2>
          <p className="text-slate-500 text-sm">Welcome back, {userProfile.displayName}</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => { setEditingItem(null); setShowForm('income'); }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all text-sm font-medium shadow-sm"
          >
            <PlusCircle size={18} /> Add Income
          </button>
          <button 
            onClick={() => { setEditingItem(null); setShowForm('expense'); }}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-all text-sm font-medium shadow-sm"
          >
            <PlusCircle size={18} /> Add Expense
          </button>
          {(userProfile.role === 'admin' || userProfile.role === 'super_admin') && (
            <button 
              onClick={onToggleVisibility}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium shadow-sm ${
                appSettings.showAmountsToPublic 
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
              title={appSettings.showAmountsToPublic ? "Hide amounts from public" : "Show amounts to public"}
            >
              {appSettings.showAmountsToPublic ? <Users size={18} /> : <Lock size={18} />}
              {appSettings.showAmountsToPublic ? "Hide Amounts" : "Show Amounts"}
            </button>
          )}
          {userProfile.role === 'super_admin' && (
            <>
              <button 
                onClick={() => setShowForm('settings')}
                className="flex items-center gap-2 px-4 py-2 bg-trust-green text-white rounded-lg hover:bg-trust-green-dark transition-all text-sm font-medium shadow-sm"
              >
                <CreditCard size={18} /> Payment Methods
              </button>
              <button 
                onClick={() => setShowForm('admin')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-all text-sm font-medium shadow-sm"
              >
                <Lock size={18} /> Manage Admins
              </button>
            </>
          )}
        </div>
      </div>

      {/* Forms Modal */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden ${showForm === 'admin' || showForm === 'settings' ? 'max-w-2xl' : 'max-w-md'}`}
            >
              <div className={`px-6 py-4 flex justify-between items-center text-white ${
                showForm === 'income' ? 'bg-emerald-600' : 
                showForm === 'expense' ? 'bg-rose-600' : 
                showForm === 'settings' ? 'bg-trust-green' :
                'bg-slate-800'
              }`}>
                <h3 className="font-bold">
                  {showForm === 'income' ? (editingItem ? 'Edit Income' : 'Add New Income') : 
                   showForm === 'expense' ? (editingItem ? 'Edit Expense' : 'Add New Expense') : 
                   showForm === 'settings' ? 'Manage Payment Methods' :
                   'Manage Admins'}
                </h3>
                <button onClick={() => { setShowForm(null); setEditingItem(null); }} className="p-1 hover:bg-white/20 rounded-full transition-colors"><X size={20} /></button>
              </div>
              <div className="p-6">
                {showForm === 'income' ? (
                  <IncomeForm onClose={() => { setShowForm(null); setEditingItem(null); }} editData={editingItem} />
                ) : showForm === 'expense' ? (
                  <ExpenseForm onClose={() => { setShowForm(null); setEditingItem(null); }} editData={editingItem} />
                ) : showForm === 'settings' ? (
                  <PaymentSettingsForm onClose={() => setShowForm(null)} paymentMethods={paymentMethods} />
                ) : (
                  <AdminManagementForm onClose={() => setShowForm(null)} />
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Income Table (Admin Only) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-emerald-50/30">
            <h3 className="font-bold text-emerald-800 flex items-center gap-2">
              <Users size={18} /> Honorable Donors (Income)
            </h3>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input 
                  type="text" 
                  placeholder="Search..."
                  value={incomeSearchTerm}
                  onChange={(e) => setIncomeSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-4 py-1 bg-white border border-slate-200 rounded-full text-xs outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>
              <button className="p-1.5 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors">
                <Search size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 text-xs uppercase tracking-wider z-10">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Donor</th>
                  <th className="px-6 py-3">Method</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncome.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-4 text-xs text-slate-500">{format(new Date(item.date), 'MM/dd/yy')}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">
                      {item.name}
                      {item.comment && <p className="text-[10px] text-slate-400 font-normal italic">{item.comment}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        item.method === 'Bikash' ? 'bg-pink-100 text-pink-700' :
                        item.method === 'Nagad' ? 'bg-orange-100 text-orange-700' :
                        item.method === 'Bank' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {item.method}
                      </span>
                      {item.paymentNumber && (
                        <p className="text-[10px] text-slate-400 mt-1 font-mono">{item.paymentNumber}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-emerald-600 text-right">৳{item.amount.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingItem(item); setShowForm('income'); }}
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button 
                          onClick={() => { if(window.confirm("Delete this record?")) onDeleteIncome(item.id, item.amount); }}
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expense Table (Admin Only) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-rose-50/30">
            <h3 className="font-bold text-rose-800 flex items-center gap-2">
              <TrendingDown size={18} /> Detailed Expenses
            </h3>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input 
                  type="text" 
                  placeholder="Search..."
                  value={expenseSearchTerm}
                  onChange={(e) => setExpenseSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-4 py-1 bg-white border border-slate-200 rounded-full text-xs outline-none focus:ring-2 focus:ring-rose-500 transition-all"
                />
              </div>
              <button className="p-1.5 bg-rose-600 text-white rounded-full hover:bg-rose-700 transition-colors">
                <Search size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 text-xs uppercase tracking-wider z-10">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Category</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExpenses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-4 text-xs text-slate-500">{format(new Date(item.date), 'MM/dd/yy')}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{item.category}</td>
                    <td className="px-6 py-4 text-sm font-bold text-rose-600 text-right">৳{item.amount.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingItem(item); setShowForm('expense'); }}
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button 
                          onClick={() => { if(window.confirm("Delete this record?")) onDeleteExpense(item.id, item.amount); }}
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Scorecard({ title, amount, icon, color, textColor, hideAmount = false }: { 
  title: string, 
  amount: number, 
  icon: React.ReactNode, 
  color: string,
  textColor: string,
  hideAmount?: boolean
}) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className={`p-6 rounded-2xl ${color} border border-white/50 shadow-sm flex items-start justify-between`}
    >
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
        <h3 className={`text-3xl font-black ${textColor}`}>
          {hideAmount ? '৳****' : `৳${amount.toLocaleString()}`}
        </h3>
      </div>
      <div className="p-3 bg-white/80 rounded-xl shadow-sm">
        {icon}
      </div>
    </motion.div>
  );
}

function IncomeForm({ onClose, isPublic = false, editData = null }: { onClose: () => void, isPublic?: boolean, editData?: IncomeRecord | null }) {
  const [formData, setFormData] = useState<{
    date: string;
    name: string;
    amount: string;
    method: 'Cash' | 'Bikash' | 'Nagad' | 'Bank';
    paymentNumber: string;
    comment: string;
  }>({
    date: editData?.date || format(new Date(), 'yyyy-MM-dd'),
    name: editData?.name || '',
    amount: editData?.amount.toString() || '',
    method: editData?.method || 'Cash',
    paymentNumber: editData?.paymentNumber || '',
    comment: editData?.comment || ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // If not public, require auth. If public, allow without auth (rules will handle)
    if (!isPublic && !auth.currentUser) return;
    
    try {
      const amount = Number(formData.amount);
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', 'main');
        const statsDoc = await transaction.get(statsRef);
        
        if (!statsDoc.exists()) {
          transaction.set(statsRef, { income: amount, expense: 0 });
        } else {
          const diff = editData ? amount - editData.amount : amount;
          transaction.update(statsRef, { income: increment(diff) });
        }
        
        if (editData) {
          const incomeRef = doc(db, 'income', editData.id);
          transaction.update(incomeRef, {
            ...formData,
            amount
          });
        } else {
          const incomeRef = doc(collection(db, 'income'));
          transaction.set(incomeRef, {
            ...formData,
            amount,
            createdBy: auth.currentUser?.uid || 'public_user'
          });
        }
      });
      onClose();
    } catch (error) {
      console.error("Error saving income:", error);
      handleFirestoreError(error, OperationType.WRITE, 'income');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
        <input 
          type="date" 
          required 
          value={formData.date}
          onChange={e => setFormData({...formData, date: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Donor Name</label>
        <input 
          type="text" 
          required 
          placeholder="e.g. Rahim Uddin"
          value={formData.name}
          onChange={e => setFormData({...formData, name: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Amount (৳)</label>
          <input 
            type="number" 
            required 
            placeholder="0"
            value={formData.amount}
            onChange={e => setFormData({...formData, amount: e.target.value})}
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Method</label>
          <select 
            value={formData.method}
            onChange={e => setFormData({...formData, method: e.target.value as 'Cash' | 'Bikash' | 'Nagad' | 'Bank'})}
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
          >
            <option value="Cash">Cash</option>
            <option value="Bikash">Bikash</option>
            <option value="Nagad">Nagad</option>
            <option value="Bank">Bank</option>
          </select>
        </div>
      </div>

      {formData.method !== 'Cash' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {formData.method} Number / Transaction ID
          </label>
          <input 
            type="text" 
            placeholder={`Enter ${formData.method} number or TrxID`}
            value={formData.paymentNumber}
            onChange={e => setFormData({...formData, paymentNumber: e.target.value})}
            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
          />
        </motion.div>
      )}

      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Comment (Optional)</label>
        <textarea 
          placeholder="Any notes..."
          value={formData.comment}
          onChange={e => setFormData({...formData, comment: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all h-20 resize-none"
        />
      </div>
      <button type="submit" className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200">
        {editData ? 'Update Income Record' : 'Save Income Record'}
      </button>
    </form>
  );
}

function ExpenseForm({ onClose, editData = null }: { onClose: () => void, editData?: ExpenseRecord | null }) {
  const [formData, setFormData] = useState({
    date: editData?.date || format(new Date(), 'yyyy-MM-dd'),
    category: editData?.category || '',
    amount: editData?.amount.toString() || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    try {
      const amount = Number(formData.amount);
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', 'main');
        const statsDoc = await transaction.get(statsRef);
        
        if (!statsDoc.exists()) {
          transaction.set(statsRef, { income: 0, expense: amount });
        } else {
          const diff = editData ? amount - editData.amount : amount;
          transaction.update(statsRef, { expense: increment(diff) });
        }
        
        if (editData) {
          const expenseRef = doc(db, 'expenses', editData.id);
          transaction.update(expenseRef, {
            ...formData,
            amount
          });
        } else {
          const expenseRef = doc(collection(db, 'expenses'));
          transaction.set(expenseRef, {
            ...formData,
            amount,
            createdBy: auth.currentUser!.uid
          });
        }
      });
      onClose();
    } catch (error) {
      console.error("Error saving expense:", error);
      handleFirestoreError(error, OperationType.WRITE, 'expenses');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
        <input 
          type="date" 
          required 
          value={formData.date}
          onChange={e => setFormData({...formData, date: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Expense Category</label>
        <input 
          type="text" 
          required 
          placeholder="e.g. Office Rent, Charity"
          value={formData.category}
          onChange={e => setFormData({...formData, category: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Amount (৳)</label>
        <input 
          type="number" 
          required 
          placeholder="0"
          value={formData.amount}
          onChange={e => setFormData({...formData, amount: e.target.value})}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
        />
      </div>
      <button type="submit" className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200">
        {editData ? 'Update Expense Record' : 'Save Expense Record'}
      </button>
    </form>
  );
}

function PaymentSettingsForm({ onClose, paymentMethods }: { onClose: () => void, paymentMethods: PaymentMethod[] }) {
  const [formData, setFormData] = useState({ name: '', number: '', type: '' });
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'settings', editingId), formData);
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'settings'), formData);
      }
      setFormData({ name: '', number: '', type: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings');
    }
  };

  const handleEdit = (method: PaymentMethod) => {
    setFormData({ name: method.name, number: method.number, type: method.type });
    setEditingId(method.id);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this payment method?")) return;
    try {
      await deleteDoc(doc(db, 'settings', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `settings/${id}`);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <input 
          placeholder="Method (e.g. Bikash)" 
          required 
          value={formData.name}
          onChange={e => setFormData({...formData, name: e.target.value})}
          className="px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-trust-green"
        />
        <input 
          placeholder="Number" 
          required 
          value={formData.number}
          onChange={e => setFormData({...formData, number: e.target.value})}
          className="px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-trust-green"
        />
        <div className="flex gap-2">
          <input 
            placeholder="Type (e.g. Personal)" 
            required 
            value={formData.type}
            onChange={e => setFormData({...formData, type: e.target.value})}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-trust-green"
          />
          <button type="submit" className="p-2 bg-trust-green text-white rounded-lg hover:bg-trust-green-dark transition-colors">
            {editingId ? <Check size={20} /> : <PlusCircle size={20} />}
          </button>
          {editingId && (
            <button 
              type="button" 
              onClick={() => { setEditingId(null); setFormData({ name: '', number: '', type: '' }); }}
              className="p-2 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        <h4 className="text-sm font-bold text-slate-500 uppercase">Current Methods</h4>
        <div className="grid gap-3">
          {paymentMethods.map((method) => (
            <div key={method.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">{method.name} ({method.type})</p>
                <p className="text-lg font-mono font-bold text-slate-800">{method.number}</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleEdit(method)}
                  className="p-2 text-slate-300 hover:text-trust-green transition-colors"
                >
                  <Pencil size={18} />
                </button>
                <button 
                  onClick={() => handleDelete(method.id)}
                  className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminManagementForm({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('admin');
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    return onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      console.error("Users fetch error:", error);
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Use email as document ID for pre-authorization
      await setDoc(doc(db, 'users', email), {
        email,
        role,
        displayName: email.split('@')[0]
      });
      setEmail('');
    } catch (error) {
      console.error("Error adding user:", error);
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
    } catch (error) {
      console.error("Error updating role:", error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to remove this user?")) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (error) {
      console.error("Error deleting user:", error);
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Add New Authorized User</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <input 
            type="email" 
            required 
            placeholder="User Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-trust-green"
          />
          <div className="flex gap-2">
            <select 
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-trust-green"
            >
              <option value="viewer">Viewer (Public Access)</option>
              <option value="admin">Admin (View Dashboard)</option>
              <option value="super_admin">Super Admin (Full Access)</option>
            </select>
            <button type="submit" className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 transition-colors">
              Add
            </button>
          </div>
        </form>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase mb-4">Authorized Users List</h4>
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
          {users.length === 0 && <p className="text-center text-slate-400 py-4 italic">No users found</p>}
          {users.map(u => (
            <div key={u.uid} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-sm gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-900 truncate max-w-[200px]">{u.email}</span>
                <span className="text-[10px] text-slate-400">{u.displayName || 'No Name'}</span>
              </div>
              
              <div className="flex items-center gap-3">
                <select 
                  value={u.role}
                  onChange={e => handleUpdateRole(u.uid, e.target.value as UserRole)}
                  className="text-xs px-2 py-1 rounded border border-slate-200 bg-slate-50 outline-none focus:ring-1 focus:ring-trust-green"
                >
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                
                <button 
                  onClick={() => handleDeleteUser(u.uid)} 
                  className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Remove User"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
