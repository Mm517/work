"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

type Props = {
  room: string; // slug
  me: { id: string; name: string };
  onClose: () => void;
};

export default function VideoPanel({ room, me, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "فشل إنشاء توكن الميتنج");
        if (!cancelled) setToken(json.token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room]);

  if (!serverUrl) {
    return (
      <div className="video-msg">
        <p>NEXT_PUBLIC_LIVEKIT_URL مش مضبوط في .env.local</p>
        <button className="btn" onClick={onClose}>إغلاق</button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="video-msg">
        <p>{error}</p>
        <button className="btn" onClick={onClose}>إغلاق</button>
      </div>
    );
  }

  if (!token) return <div className="video-msg">بنجهز الميتنج…</div>;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect
      video
      audio
      data-lk-theme="default"
      onDisconnected={onClose}
      style={{ height: "100%" }}
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
