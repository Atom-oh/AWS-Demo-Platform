'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { authEnabled } from '@/lib/auth-config';
import { login as doLogin, refreshTokens, logoutRedirect } from '@/lib/auth';
import { decodeJwtPayload } from '@/lib/pkce';
import {
  setTokens,
  getRefreshToken,
  getAccessExp,
  getIdToken,
  clearTokens,
} from '@/lib/token-store';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  username?: string;
  email?: string;
  login: () => void;
  logout: () => void;
}

const Ctx = createContext<AuthState>({
  status: 'loading',
  login: () => {},
  logout: () => {},
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(authEnabled ? 'loading' : 'authenticated');
  const [info, setInfo] = useState<{ username?: string; email?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!authEnabled) return; // dev bypass — mirrors api skipJwt

    const applyDisplay = () => {
      const p = decodeJwtPayload(getIdToken());
      setInfo({
        username: (p['cognito:username'] as string) ?? (p['username'] as string),
        email: p['email'] as string,
      });
    };

    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      const ms = Math.max(5_000, (getAccessExp() - 60) * 1000 - Date.now());
      timer.current = setTimeout(() => void silentRefresh(), ms);
    };

    const silentRefresh = async (): Promise<void> => {
      const rt = getRefreshToken();
      if (!rt) {
        clearTokens();
        setStatus('anonymous');
        return;
      }
      try {
        setTokens(await refreshTokens(rt));
        applyDisplay();
        setStatus('authenticated');
        scheduleRefresh();
      } catch {
        clearTokens();
        setStatus('anonymous');
      }
    };

    void silentRefresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const logout = () => {
    clearTokens();
    logoutRedirect();
  };

  return (
    <Ctx.Provider
      value={{ status, username: info.username, email: info.email, login: () => void doLogin(), logout }}
    >
      {children}
    </Ctx.Provider>
  );
}
