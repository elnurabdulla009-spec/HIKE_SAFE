import { useEffect, useState } from 'react';
import { api } from '../data/index.ts';

/**
 * null = still checking, true = signed in, false = not signed in.
 * Screens that need a session render <Redirect href="/sign-in" /> on false,
 * so opening or reloading /contacts or /plan while signed out goes to sign-in.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api.getSession().then((s) => { if (alive) setSignedIn(s !== null); }, () => { if (alive) setSignedIn(false); });
    return () => { alive = false; };
  }, []);
  return signedIn;
}
