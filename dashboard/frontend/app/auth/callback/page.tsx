'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { exchangeCodeForTokens, readState, clearPkce, login } from '@/lib/auth';
import { setTokens } from '@/lib/token-store';

function CallbackInner() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    void (async () => {
      try {
        if (!code) throw new Error('missing authorization code');
        if (!state || state !== readState()) throw new Error('state mismatch (possible CSRF)');
        const tokens = await exchangeCodeForTokens(code);
        setTokens(tokens);
        clearPkce();
        // Full reload to '/' so AuthProvider re-mints from the stored refresh token.
        window.location.assign('/');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [params]);

  if (error) {
    return (
      <div className="empty">
        로그인 실패: {error}
        <div style={{ marginTop: 12 }}>
          <button className="btn off" onClick={() => void login()}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }
  return <div className="empty">로그인 처리 중…</div>;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="empty">로딩 중…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
