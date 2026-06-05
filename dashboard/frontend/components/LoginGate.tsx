'use client';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';

// Guards the dashboard: the project grid (and its /api/* calls) never mount
// until authenticated. /auth/callback renders OUTSIDE this gate.
export function LoginGate({ children }: { children: ReactNode }) {
  const { status, login } = useAuth();

  if (status === 'loading') {
    return <div className="empty">로그인 확인 중…</div>;
  }
  if (status === 'anonymous') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <b>AWS Demo Platform</b>
          <span>관리자 로그인이 필요합니다</span>
          <button className="btn off" onClick={login}>
            Cognito로 로그인
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
