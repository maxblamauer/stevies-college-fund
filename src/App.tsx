import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useTheme } from './ThemeContext';
import { Upload } from './components/Upload';
import { TransactionList } from './components/TransactionList';
import { Dashboard } from './components/Dashboard';
import { MappingsManager } from './components/MappingsManager';
import { Login } from './components/Login';
import { HouseholdSetup } from './components/HouseholdSetup';
import { OnboardingMappingSetup } from './components/OnboardingMappingSetup';
import stevieLogoMarkSm from './assets/stevie-logo-mark-sm.png';
import stevieMoodGood from './assets/stevie-mood-happy.png';
import stevieMoodBad from './assets/stevie-mood-skeptical.png';
import { pickStevieQuip, type StevieMoodReport } from './lib/stevieMood';
import { StevieThoughtBubble } from './components/ui/StevieThoughtBubble';
import './App.css';

const APP_BRAND_NAME = 'Stevies College Fund';

type Tab = 'dashboard' | 'transactions' | 'upload' | 'mappings';

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
  const { theme, setTheme } = useTheme();
  const authUidRef = useRef<string | null>(null);
  const [showMappingOnboarding, setShowMappingOnboarding] = useState(false);
  const [stevieMood, setStevieMood] = useState<StevieMoodReport | null>(null);
  const [steviePopoverOpen, setSteviePopoverOpen] = useState(false);
  const [stevieQuip, setStevieQuip] = useState('');

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
    setSteviePopoverOpen(false);
    // Keep mood when moving between Dashboard ↔ Transactions (same filters in App state).
    // Only clear when leaving those tabs so Upload/Mappings don’t show a stale trend face.
    if (activeTab !== 'dashboard' && activeTab !== 'transactions') {
      setStevieMood(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!steviePopoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSteviePopoverOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steviePopoverOpen]);

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

  const stevieWorried = stevieMood?.kind === 'bad';
  const stevieMoodSrc = stevieWorried ? stevieMoodBad : stevieMoodGood;

  const stevieStatLinkEligible =
    (activeTab === 'dashboard' || activeTab === 'transactions') &&
    stevieMood != null &&
    (stevieMood.kind === 'good' ||
      stevieMood.kind === 'bad' ||
      Boolean(stevieMood.detail));

  /** Highlight the related stat card only while the Stevie popover is open; colour follows the logo (green happy, red worried). */
  const stevieStatHighlight: 'good' | 'bad' | null =
    steviePopoverOpen && stevieStatLinkEligible && stevieMood
      ? stevieMood.kind === 'bad'
        ? 'bad'
        : 'good'
      : null;

  const toggleSteviePopover = () => {
    if (steviePopoverOpen) {
      setSteviePopoverOpen(false);
    } else {
      setStevieQuip(pickStevieQuip(stevieMood?.kind ?? 'neutral'));
      setSteviePopoverOpen(true);
    }
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
            <button
              type="button"
              className={`stevie-mood-btn stevie-mood-btn--${stevieWorried ? 'bad' : 'good'}`}
              onClick={toggleSteviePopover}
              aria-expanded={steviePopoverOpen}
              aria-haspopup="dialog"
              aria-label={
                stevieWorried
                  ? 'Stevie — spending is up. Show note.'
                  : stevieMood?.kind === 'good'
                    ? 'Stevie — spending is down vs before. Show note.'
                    : 'Stevie — show note'
              }
            >
              <div className="stevie-logo-clip stevie-logo-clip-sm" aria-hidden>
                <img src={stevieMoodSrc} alt="" />
              </div>
            </button>
            {steviePopoverOpen && (
              <>
                <div
                  className="stevie-mood-backdrop"
                  onClick={() => setSteviePopoverOpen(false)}
                  aria-hidden
                />
                <StevieThoughtBubble>
                  <p className="stevie-mood-quip">{stevieQuip}</p>
                </StevieThoughtBubble>
              </>
            )}
          </div>
          <h1>{householdName}</h1>
        </div>
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
                  <div className="user-menu-header">
                    <div className="user-menu-household-row">
                      <div className="stevie-logo-clip stevie-logo-clip-xs" aria-hidden>
                        <img src={stevieLogoMarkSm} alt="" />
                      </div>
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
            onStevieMood={setStevieMood}
            stevieStatHighlight={stevieStatHighlight}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList
            key={`${householdId}-${categoryFilter || 'all'}`}
            onUpdate={refresh}
            initialCategory={categoryFilter}
            initialStatement={selectedStatement}
            initialCardholder={cardholder}
            householdId={householdId}
            onStevieMood={setStevieMood}
            stevieStatHighlight={stevieStatHighlight}
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
        {activeTab === 'mappings' && <MappingsManager key={refreshKey} householdId={householdId} />}
      </main>
    </div>
  );
}

export default App;
