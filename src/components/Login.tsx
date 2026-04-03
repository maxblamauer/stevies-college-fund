import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useEffect, useState } from 'react';
import stevieLogoWithText from '../assets/stevie-logo-with-text.png';
/** Login only: skeptical Stevie with curved “STEVIES COLLEGE FUND” band (red ring). In-app header uses stevie-mood-skeptical.png instead. */
import stevieLogoLoginNoteOpen from '../assets/stevie-logo-login-note-open.png';
import { ThemeToggleButton } from './ui/ThemeToggleButton';
import { StevieThoughtBubble } from './ui/StevieThoughtBubble';

export function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginStevieOpen, setLoginStevieOpen] = useState(false);

  useEffect(() => {
    if (!loginStevieOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLoginStevieOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginStevieOpen]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <ThemeToggleButton />
      <div className="login-layout">
        <div className="login-card">
          <div className="login-card-body">
            <div className="login-card-header">
              <h1 className="sr-only">Stevies College Fund</h1>
              <div className="login-brand-stack">
                <div className="login-stevie-anchor stevie-mood-anchor">
                  <button
                    type="button"
                    className="login-stevie-logo-btn"
                    onClick={() => setLoginStevieOpen((open) => !open)}
                    aria-expanded={loginStevieOpen}
                    aria-haspopup="dialog"
                    aria-label="Note from Stevie"
                  >
                    <div className="login-logo-wrap">
                      <img
                        src={loginStevieOpen ? stevieLogoLoginNoteOpen : stevieLogoWithText}
                        alt=""
                        className="login-brand-logo"
                        width={256}
                        height={256}
                      />
                    </div>
                  </button>
                  {loginStevieOpen && (
                    <>
                      <div
                        className="stevie-mood-backdrop"
                        onClick={() => setLoginStevieOpen(false)}
                        aria-hidden
                      />
                      <div className="login-stevie-from-logo-popover">
                        <StevieThoughtBubble variant="login">
                          <p className="stevie-mood-quip">
                            I will bark at your spending habits here and there.
                          </p>
                        </StevieThoughtBubble>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className="login-subtitle">Log in to contribute to Stevies College Fund.</p>
            </div>

            <div className="login-actions">
              <button
                type="button"
                className="google-signin-btn"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                {loading ? (
                  <span className="login-btn-spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                )}
                {loading ? 'Signing in...' : 'Sign in with Google'}
              </button>
              {error && <p className="login-error">{error}</p>}
            </div>
          </div>

          <div className="login-card-footer">
            <p className="login-note">Secure sign-in with Google. Your data stays in your household.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
