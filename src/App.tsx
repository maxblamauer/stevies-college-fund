import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
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
        setMenuOpen(false);
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
        <div className="header-right">
          <div className="user-menu-wrapper">
            <button className="user-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
              {user.displayName?.split(' ')[0] || 'Menu'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="user-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="user-menu">
                  <div className="user-menu-header">
                    <div className="user-menu-household-row">
                      <span className="user-menu-item-icon" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 11 12 5l8 6v9H4V11z" />
                        </svg>
                      </span>
                      <span className="user-menu-household-name">{householdName}</span>
                    </div>
                  </div>
                  {inviteCode && (
                    <button
                      className="user-menu-item user-menu-action"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteCode);
                        setCodeCopied(true);
                        setTimeout(() => setCodeCopied(false), 2000);
                      }}
                    >
                      <span className="user-menu-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="8" y="8" width="12" height="12" rx="1" />
                          <path d="M5 15V6a1 1 0 0 1 1-1h9" />
                        </svg>
                      </span>
                      <span className="user-menu-item-label">
                        Invite code: <span className="invite-code-inline">{inviteCode}</span>
                      </span>
                      <span className="invite-code-hint">{codeCopied ? 'Copied!' : ''}</span>
                    </button>
                  )}
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item user-menu-action"
                    onClick={() => {
                      setTheme(theme === 'dark' ? 'light' : 'dark');
                      setMenuOpen(false);
                    }}
                  >
                    <span className="user-menu-item-icon">
                      {theme === 'dark' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3.5" />
                          <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 9a7 7 0 1 1-9 9 6 6 0 1 0 9-9" />
                        </svg>
                      )}
                    </span>
                    <span className="user-menu-item-label">{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
                  </button>
                  <button className="user-menu-item user-menu-action user-menu-danger" onClick={handleLogout}>
                    <span className="user-menu-item-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 5v14" />
                        <path d="M15 12h7" />
                        <path d="m18 9 3 3-3 3" />
                      </svg>
                    </span>
                    <span className="user-menu-item-label">Sign out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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
          />
        )}
      </main>
    </div>
  );
}

export default App;
