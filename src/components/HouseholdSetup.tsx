import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { doc, setDoc, addDoc, collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import stevieLogoWithText from '../assets/stevie-logo-with-text.png';
import stevieLogoRedBadge from '../assets/stevie-logo-login-note-open.png';
import { ThemeToggleButton } from './ui/ThemeToggleButton';

interface Props {
  uid: string;
  userName: string;
  userEmail: string;
  onComplete: (justCreated?: boolean) => void;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function HouseholdSetup({ uid, userName, userEmail, onComplete }: Props) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoRedBadge, setLogoRedBadge] = useState(false);

  const createHousehold = async () => {
    if (!householdName.trim()) {
      setError('Enter a household name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const code = generateInviteCode();
      const householdRef = await addDoc(collection(db, 'households'), {
        name: householdName.trim(),
        inviteCode: code,
        createdBy: uid,
        createdAt: Timestamp.now(),
      });

      await setDoc(doc(db, 'households', householdRef.id, 'members', uid), {
        email: userEmail,
        name: userName,
        joinedAt: Timestamp.now(),
      });

      await setDoc(doc(db, 'users', uid), {
        householdId: householdRef.id,
        email: userEmail,
        name: userName,
      });

      onComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setLoading(false);
    }
  };

  const switchGoogleAccount = async () => {
    setError('');
    try {
      await signOut(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out');
    }
  };

  const joinHousehold = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError('Enter an invite code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const q = query(collection(db, 'households'), where('inviteCode', '==', code));
      const snap = await getDocs(q);

      if (snap.empty) {
        setError('Invalid invite code');
        setLoading(false);
        return;
      }

      const householdDoc = snap.docs[0];

      await setDoc(doc(db, 'households', householdDoc.id, 'members', uid), {
        email: userEmail,
        name: userName,
        joinedAt: Timestamp.now(),
      });

      await setDoc(doc(db, 'users', uid), {
        householdId: householdDoc.id,
        email: userEmail,
        name: userName,
      });

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join household');
    } finally {
      setLoading(false);
    }
  };

  const heading =
    mode === 'choose' ? 'Welcome' : mode === 'create' ? 'Name your household' : 'Join a household';

  return (
    <div className="login-container">
      <ThemeToggleButton />
      <div className="household-layout">
        <div className="household-card">
          <div className="household-card-body">
            <div className="household-card-header">
              <button
                type="button"
                className="onboarding-logo-btn"
                onClick={() => setLogoRedBadge((v) => !v)}
                aria-pressed={logoRedBadge}
                aria-label={logoRedBadge ? 'Show green wordmark logo' : 'Show red wordmark logo'}
              >
                <div className="household-logo-wrap">
                  <img
                    src={logoRedBadge ? stevieLogoRedBadge : stevieLogoWithText}
                    alt=""
                    className="household-brand-logo"
                    width={256}
                    height={256}
                  />
                </div>
              </button>
              <h1 className="household-title">{heading}</h1>
            </div>

            {mode === 'choose' && (
              <>
                <p className="login-subtitle household-subtitle">Set up your household to get started</p>
                <div className="household-options">
                  <button type="button" className="household-option" onClick={() => { setError(''); setMode('create'); }}>
                    <strong>Create household</strong>
                    <span>Start fresh and invite others to join</span>
                  </button>
                  <button type="button" className="household-option" onClick={() => { setError(''); setMode('join'); }}>
                    <strong>Join household</strong>
                    <span>Enter an invite code from someone</span>
                  </button>
                </div>
              </>
            )}

            {mode === 'create' && (
              <>
                <p className="login-subtitle household-subtitle">
                  This name appears throughout the app for your household.
                </p>
                <input
                  type="text"
                  className="household-input"
                  placeholder="e.g. Denver's College Fund"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void createHousehold();
                    }
                  }}
                  autoFocus
                />
                <div className="household-actions household-actions--single-primary">
                  <button
                    type="button"
                    className="btn btn-save"
                    onClick={() => void createHousehold()}
                    disabled={loading}
                  >
                    {loading ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </>
            )}

            {mode === 'join' && (
              <>
                <p className="login-subtitle household-subtitle">Enter the invite code</p>
                <input
                  type="text"
                  className="household-input invite-code-input"
                  placeholder="ABC123"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && void joinHousehold()}
                  maxLength={6}
                  autoFocus
                />
                <div className="household-actions household-actions--single-primary">
                  <button type="button" className="btn btn-save" onClick={() => void joinHousehold()} disabled={loading}>
                    {loading ? 'Joining...' : 'Join'}
                  </button>
                </div>
              </>
            )}

            {error && <p className="login-error household-inline-error">{error}</p>}
          </div>

          {(mode === 'choose' || mode === 'create' || mode === 'join') && (
            <div className="household-card-footer">
              <button type="button" className="household-setup-account-back" onClick={() => void switchGoogleAccount()}>
                Use a different Google account
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
