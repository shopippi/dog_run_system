import type { StaffMe } from '@dr/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, adminApi, adminPost } from './api';

type AuthState = {
  staff: StaffMe | null;
  loading: boolean;
  error: unknown;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 製作者(見るだけ)のアカウントか */
  readOnly: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStaff(await adminApi<StaffMe>('/me'));
    } catch (e) {
      setStaff(null);
      if (!(e instanceof ApiError && e.status === 401)) setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    await adminPost('/login', { email, password });
    await refresh();
  };

  const logout = async () => {
    try {
      await adminPost('/logout');
    } finally {
      setStaff(null);
    }
  };

  return (
    <AuthContext.Provider value={{ staff, loading, error, login, logout, readOnly: staff?.role === 'developer' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider がありません');
  return ctx;
}
