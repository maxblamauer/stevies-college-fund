import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useTheme } from './ThemeContext';
import { Upload } from './components/Upload';
import { TransactionList } from './components/TransactionList';
import { Dashboard } from './components/Dashboard';
import { MappingsManager } from './components/MappingsManager';
import { Login } from './components/Login';
import { HouseholdSetup } from './components/HouseholdSetup';
import { OnboardingMappingSetup } from './components/OnboardingMappingSetup';
import stevieMoodGood from './assets/stevie-mood-happy.png';
import type { StevieMoodReport } from './lib/stevieMood';
import './App.css';

const APP_BRAND_NAME = 'Stevies College Fund';

type Tab = 'dashboard' | 'transactions' | 'upload' | 'settings';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [householdLoading, setHouseholdLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedStatement, setSelectedStatement] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [cardholder, setCardholder] = useState('');
  const [selectedCard, setSelectedCard] = useState('');
  const [blurAmounts, setBlurAmounts] = useState(() => localStorage.getItem('blurAmounts') === 'true');
  const [statementMonthOffset, setStatementMonthOffset] = useState(() => {
    const saved = localStorage.getItem('statementMonthOffset');
    return saved ? parseInt(saved, 10) : 0;
  });
  const { theme, setTheme } = useTheme();

  const toggleBlurAmounts = (v: boolean) => {
    setBlurAmounts(v);
    localStorage.setItem('blurAmounts', String(v));
  };
  const handleStatementMonthOffsetChange = (v: number) => {
    setStatementMonthOffset(v);
    localStorage.setItem('statementMonthOffset', String(v));
  };
  const authUidRef = useRef<string | null>(null);
  const [showMappingOnboarding, setShowMappingOnboarding] = useState(false);
  const [, setStevieMood] = useState<StevieMoodReport | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const uid = firebaseUser?.uid ?? null;
      if (authUidRef.current !== uid) {
        authUidRef.current = uid;
      }
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setHouseholdId(null);
        setHouseholdName('');
        setInviteCode('');
        setShowMappingOnboarding(false);
      }
    });
    return unsubscribe;
  }, []);

  // Load household info when user is authenticated
  useEffect(() => {
    if (!user) return;
    loadHousehold();
  }, [user]);

  useEffect(() => {
    document.title = APP_BRAND_NAME;
  }, []);

  useEffect(() => {
    if (activeTab !== 'dashboard' && activeTab !== 'transactions' && activeTab !== 'settings') {
      setStevieMood(null);
    }
  }, [activeTab]);

  const loadHousehold = async () => {
    if (!user) return;
    setHouseholdLoading(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setHouseholdId(data.householdId);
        // Load household info
        const householdDoc = await getDoc(doc(db, 'households', data.householdId));
        if (householdDoc.exists()) {
          const hData = householdDoc.data();
          setHouseholdName(
            typeof hData.name === 'string' && hData.name.trim() ? hData.name.trim() : 'Household',
          );
          setInviteCode(hData.inviteCode || '');
          // Resume onboarding if the household creator hasn't completed it yet
          if (!hData.onboardingComplete && hData.createdBy === user.uid) {
            // Check if card profiles already exist (household set up before this flag existed)
            const cardProfilesSnap = await getDocs(collection(db, 'households', data.householdId, 'cardProfiles'));
            if (cardProfilesSnap.empty) {
              setShowMappingOnboarding(true);
            }
          }
        } else {
          setHouseholdName('Household');
        }
      } else {
        setHouseholdId(null);
        setHouseholdName('');
      }
    } catch (err) {
      console.error('Failed to load household:', err);
      setHouseholdId(null);
      setHouseholdName('');
    } finally {
      setHouseholdLoading(false);
    }
  };

  const refresh = () => setRefreshKey((k) => k + 1);

  const navigateToCategory = (category: string) => {
    setCategoryFilter(category);
    setActiveTab('transactions');
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleDeleteAccount = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      // Delete all Firestore data
      if (householdId) {
        const subcollections = ['transactions', 'statements', 'categoryMappings', 'cardProfiles', 'fixedExpenses', 'incomeSources', 'members'];
        for (const sub of subcollections) {
          const snap = await getDocs(collection(db, 'households', householdId, sub));
          // Batch delete in groups of 500 (Firestore limit)
          let batch = writeBatch(db);
          let count = 0;
          for (const d of snap.docs) {
            batch.delete(d.ref);
            count++;
            if (count >= 500) {
              await batch.commit();
              batch = writeBatch(db);
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        }
        // Delete the household document
        await deleteDoc(doc(db, 'households', householdId));
      }

      // Delete the user document
      await deleteDoc(doc(db, 'users', currentUser.uid));

      // Delete the Firebase Auth user (must be last)
      await currentUser.delete();
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        alert('For security, please sign out and sign back in first, then try deleting again.');
      } else {
        alert('Failed to delete account. Please try again.');
        console.error('Delete account error:', err);
      }
    }
  };

  const stevieStatHighlight: 'good' | 'bad' | null = null;

  if (authLoading) {
    return <div className="app"><div className="auth-loading">Loading...</div></div>;
  }

  if (!user) {
    return <Login />;
  }

  if (householdLoading) {
    return <div className="app"><div className="auth-loading">Loading...</div></div>;
  }

  if (!householdId) {
    return (
      <HouseholdSetup
        uid={user.uid}
        userName={user.displayName || ''}
        userEmail={user.email || ''}
        onComplete={(justCreated?: boolean) => {
          if (justCreated) setShowMappingOnboarding(true);
          loadHousehold();
        }}
      />
    );
  }

  if (showMappingOnboarding && householdId) {
    return (
      <OnboardingMappingSetup
        householdId={householdId}
        onComplete={() => setShowMappingOnboarding(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <div className="stevie-mood-anchor">
            <div className="stevie-mood-btn stevie-mood-btn--good">
              <div className="stevie-logo-clip stevie-logo-clip-sm" aria-hidden>
                <img src={stevieMoodGood} alt="" />
              </div>
            </div>
          </div>
          <h1>{householdName}</h1>
        </div>
        <nav className="tabs">
          {(['dashboard', 'transactions', 'upload', 'settings'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                if (tab !== 'transactions') setCategoryFilter('');
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main className={`app-main${blurAmounts ? ' blur-amounts' : ''}`}>
        {activeTab === 'dashboard' && (
          <Dashboard
            key={refreshKey}
            onCategoryClick={navigateToCategory}
            theme={theme}
            householdId={householdId}
            selectedStatement={selectedStatement}
            onStatementChange={setSelectedStatement}
            selectedYear={selectedYear}
            onYearChange={setSelectedYear}
            cardholder={cardholder}
            onCardholderChange={setCardholder}
            selectedCard={selectedCard}
            onCardChange={setSelectedCard}
            onStevieMood={setStevieMood}
            stevieStatHighlight={stevieStatHighlight}
            statementMonthOffset={statementMonthOffset}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList
            key={`${householdId}-${categoryFilter || 'all'}`}
            onUpdate={refresh}
            initialCategory={categoryFilter}
            initialStatement={selectedStatement}
            initialCardholder={cardholder}
            initialCard={selectedCard}
            initialYear={selectedYear}
            onYearChange={setSelectedYear}
            onCardChange={setSelectedCard}
            householdId={householdId}
            onStevieMood={setStevieMood}
            stevieStatHighlight={stevieStatHighlight}
            statementMonthOffset={statementMonthOffset}
          />
        )}
        {activeTab === 'upload' && (
          <Upload
            onUploaded={(newStatementId) => {
              refresh();
              if (newStatementId) {
                setSelectedStatement(newStatementId);
                setCategoryFilter('');
              }
              setActiveTab('transactions');
            }}
            householdId={householdId}
          />
        )}
        {activeTab === 'settings' && (
          <MappingsManager
            key={refreshKey}
            householdId={householdId}
            blurAmounts={blurAmounts}
            onBlurAmountsChange={toggleBlurAmounts}
            statementMonthOffset={statementMonthOffset}
            onStatementMonthOffsetChange={handleStatementMonthOffsetChange}
            householdName={householdName}
            inviteCode={inviteCode}
            theme={theme}
            onThemeChange={setTheme}
            onLogout={handleLogout}
            onDeleteAccount={handleDeleteAccount}
            userName={user.displayName || 'User'}
          />
        )}
      </main>
    </div>
  );
}

export default App;
