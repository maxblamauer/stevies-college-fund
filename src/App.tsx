import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { Upload } from './components/Upload';
import { TransactionList } from './components/TransactionList';
import { Dashboard } from './components/Dashboard';
import { MappingsManager } from './components/MappingsManager';
import { Login } from './components/Login';
import { HouseholdSetup } from './components/HouseholdSetup';
import './App.css';

type Tab = 'dashboard' | 'transactions' | 'upload' | 'mappings';
type Theme = 'dark' | 'light';

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
  const [cardholder, setCardholder] = useState('');
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'dark';
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setHouseholdId(null);
        setInviteCode('');
      }
    });
    return unsubscribe;
  }, []);

  // Load household info when user is authenticated
  useEffect(() => {
    if (!user) return;
    loadHousehold();
  }, [user]);

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
          setInviteCode(hData.inviteCode || '');
          setHouseholdName(hData.name || '');
        }
      } else {
        setHouseholdId(null);
      }
    } catch (err) {
      console.error('Failed to load household:', err);
      setHouseholdId(null);
    } finally {
      setHouseholdLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const navigateToCategory = (category: string) => {
    setCategoryFilter(category);
    setActiveTab('transactions');
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

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
        onComplete={loadHousehold}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>{householdName || 'Spending Tracker'}</h1>
        <nav className="tabs">
          {(['dashboard', 'transactions', 'upload', 'mappings'] as Tab[]).map((tab) => (
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
                  {householdName && (
                    <div className="user-menu-header">
                      <div className="user-menu-household-row">
                        <span className="user-menu-item-icon">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 10.5 12 3l9 7.5" />
                            <path d="M5 9.5V21h14V9.5" />
                          </svg>
                        </span>
                        <span className="user-menu-household-name">{householdName}</span>
                      </div>
                    </div>
                  )}
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="5" />
                          <path d="M12 1v2.2M12 20.8V23M4.22 4.22l1.56 1.56M18.22 18.22l1.56 1.56M1 12h2.2M20.8 12H23M4.22 19.78l1.56-1.56M18.22 5.78l1.56-1.56" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3a7.5 7.5 0 1 0 9 9A9 9 0 1 1 12 3Z" />
                        </svg>
                      )}
                    </span>
                    <span className="user-menu-item-label">{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
                  </button>
                  <button className="user-menu-item user-menu-action user-menu-danger" onClick={handleLogout}>
                    <span className="user-menu-item-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="m16 17 5-5-5-5" />
                        <path d="M21 12H9" />
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
      <main className="app-main">
        {activeTab === 'dashboard' && (
          <Dashboard
            key={refreshKey}
            onCategoryClick={navigateToCategory}
            theme={theme}
            householdId={householdId}
            selectedStatement={selectedStatement}
            onStatementChange={setSelectedStatement}
            cardholder={cardholder}
            onCardholderChange={setCardholder}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList
            key={`${refreshKey}-${categoryFilter}`}
            onUpdate={refresh}
            initialCategory={categoryFilter}
            initialStatement={selectedStatement}
            householdId={householdId}
          />
        )}
        {activeTab === 'upload' && <Upload onUploaded={() => { refresh(); setActiveTab('transactions'); }} householdId={householdId} />}
        {activeTab === 'mappings' && <MappingsManager key={refreshKey} householdId={householdId} />}
      </main>
    </div>
  );
}

export default App;
