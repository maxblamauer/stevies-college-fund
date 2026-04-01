import { useState, useEffect } from 'react';
import { Upload } from './components/Upload';
import { TransactionList } from './components/TransactionList';
import { Dashboard } from './components/Dashboard';
import { MappingsManager } from './components/MappingsManager';
import './App.css';

type Tab = 'dashboard' | 'transactions' | 'upload' | 'mappings';
type Theme = 'dark' | 'light';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const navigateToCategory = (category: string) => {
    setCategoryFilter(category);
    setActiveTab('transactions');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Spending Tracker</h1>
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
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
        </div>
      </header>
      <main className="app-main">
        {activeTab === 'dashboard' && <Dashboard key={refreshKey} onCategoryClick={navigateToCategory} theme={theme} />}
        {activeTab === 'transactions' && <TransactionList key={`${refreshKey}-${categoryFilter}`} onUpdate={refresh} initialCategory={categoryFilter} />}
        {activeTab === 'upload' && <Upload onUploaded={() => { refresh(); setActiveTab('transactions'); }} />}
        {activeTab === 'mappings' && <MappingsManager key={refreshKey} />}
      </main>
    </div>
  );
}

export default App;
