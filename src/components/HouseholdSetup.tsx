import { useState } from 'react';
import { doc, setDoc, addDoc, collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface Props {
  uid: string;
  userName: string;
  userEmail: string;
  onComplete: () => void;
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

      // Add user as member
      await setDoc(doc(db, 'households', householdRef.id, 'members', uid), {
        email: userEmail,
        name: userName,
        joinedAt: Timestamp.now(),
      });

      // Create user doc pointing to household
      await setDoc(doc(db, 'users', uid), {
        householdId: householdRef.id,
        email: userEmail,
        name: userName,
      });

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setLoading(false);
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

      // Add user as member
      await setDoc(doc(db, 'households', householdDoc.id, 'members', uid), {
        email: userEmail,
        name: userName,
        joinedAt: Timestamp.now(),
      });

      // Create user doc pointing to household
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

  return (
    <div className="login-container">
      <div className="household-card">
        <h1>Welcome to Spending Tracker</h1>

        {mode === 'choose' && (
          <>
            <p className="login-subtitle">Set up your household to get started</p>
            <div className="household-options">
              <button className="household-option" onClick={() => setMode('create')}>
                <strong>Create Household</strong>
                <span>Start fresh and invite others to join</span>
              </button>
              <button className="household-option" onClick={() => setMode('join')}>
                <strong>Join Household</strong>
                <span>Enter an invite code from someone</span>
              </button>
            </div>
          </>
        )}

        {mode === 'create' && (
          <>
            <p className="login-subtitle">Name your household</p>
            <input
              type="text"
              className="household-input"
              placeholder="e.g. The Blamauers"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createHousehold()}
              autoFocus
            />
            <div className="household-actions">
              <button className="btn" onClick={() => setMode('choose')}>Back</button>
              <button className="btn btn-save" onClick={createHousehold} disabled={loading}>
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        )}

        {mode === 'join' && (
          <>
            <p className="login-subtitle">Enter the invite code</p>
            <input
              type="text"
              className="household-input invite-code-input"
              placeholder="ABC123"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinHousehold()}
              maxLength={6}
              autoFocus
            />
            <div className="household-actions">
              <button className="btn" onClick={() => setMode('choose')}>Back</button>
              <button className="btn btn-save" onClick={joinHousehold} disabled={loading}>
                {loading ? 'Joining...' : 'Join'}
              </button>
            </div>
          </>
        )}

        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
