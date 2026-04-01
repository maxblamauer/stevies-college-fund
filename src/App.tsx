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
              onClick={() => { setActiveTab(tab); if (tab !== 'transactions') setCategoryFilter(''); }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <div className="user-menu-wrapper">
            <button className="user-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
              {user.displayName}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="user-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="user-menu">
                  {householdName && (
                    <div className="user-menu-section">
                      <div className="user-menu-label">Household</div>
                      <div className="user-menu-value">{householdName}</div>
                    </div>
                  )}
                  {inviteCode && (
                    <div className="user-menu-section">
                      <div className="user-menu-label">Invite Code</div>
                      <button
                        className="invite-code-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(inviteCode);
                          setCodeCopied(true);
                          setTimeout(() => setCodeCopied(false), 2000);
                        }}
                      >
                        <span className="invite-code-text">{inviteCode}</span>
                        <span className="invite-code-hint">{codeCopied ? 'Copied!' : 'Click to copy'}</span>
                      </button>
                    </div>
                  )}
                  <div className="user-menu-divider" />
                  <button className="user-menu-item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); }}>
                    {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'} {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </button>
                  <button className="user-menu-item" onClick={handleLogout}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="app-main">
        {activeTab === 'dashboard' && <Dashboard key={refreshKey} onCategoryClick={navigateToCategory} theme={theme} householdId={householdId} />}
        {activeTab === 'transactions' && <TransactionList key={`${refreshKey}-${categoryFilter}`} onUpdate={refresh} initialCategory={categoryFilter} householdId={householdId} />}
        {activeTab === 'upload' && <Upload onUploaded={() => { refresh(); setActiveTab('transactions'); }} householdId={householdId} />}
        {activeTab === 'mappings' && <MappingsManager key={refreshKey} householdId={householdId} />}
      </main>
    </div>
  );
}

export default App;
