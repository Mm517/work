"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError("");
    const { data, error: err } = await getSupabase().rpc("accept_invite", { p_token: token });
    if (err || !data) {
      setError("الدعوة دي مش صالحة أو انتهت أو اتشالت منها.");
      setBusy(false);
      return;
    }
    router.replace(`/w/${data as string}`);
  }

  return (
    <main className="home">
      <div className="home-card">
        <div className="logo">
          كتشنيلي <span>وورك</span>
        </div>
        <p>اتعزمت على غرفة شغل. تحب تنضم؟</p>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" onClick={join} disabled={busy}>
          انضم للغرفة
        </button>
      </div>
    </main>
  );
}
