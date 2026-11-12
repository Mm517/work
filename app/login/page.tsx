"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { safeNext } from "@/lib/types";

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ? "فشل تسجيل الدخول، جرّب تاني." : "");

  const redirectTo = () => `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function magic(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: err } = await getSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo() },
      });
      if (err) setError(err.message);
      else setSent(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  async function github() {
    setError("");
    try {
      const { error: err } = await getSupabase().auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: redirectTo() },
      });
      if (err) setError(err.message);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  return (
    <main className="home">
      <form className="home-card" onSubmit={magic}>
        <div className="logo">
          كتشنيلي <span>وورك</span>
        </div>
        {sent ? (
          <p>
            بعتنالك لينك دخول على <b dir="ltr">{email}</b>. افتحه من نفس المتصفح.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              سجّل دخولك بالإيميل (هنبعتلك لينك دخول من غير باسورد).
            </p>
            <label className="field">
              الإيميل
              <input
                className="input"
                dir="ltr"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" type="submit" disabled={busy}>
              ابعتلي لينك الدخول
            </button>
            <button className="btn" type="button" onClick={github}>
              الدخول بحساب GitHub
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="empty">…</div>}>
      <LoginForm />
    </Suspense>
  );
}
