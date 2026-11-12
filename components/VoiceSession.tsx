"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, TrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";

type Props = { room: string; voiceRoomId: string; name: string; onLeave: () => void };

/** Audio-only LiveKit session for a persistent voice room. Renders a tiny control bar. */
export default function VoiceSession({ room, voiceRoomId, name, onLeave }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, kind: "voice", voiceRoomId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "فشل الدخول للروم الصوتي");
        if (!cancelled) setToken(json.token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, voiceRoomId]);

  if (!serverUrl) return <div className="voice-bar error">NEXT_PUBLIC_LIVEKIT_URL مش مضبوط</div>;
  if (error)
    return (
      <div className="voice-bar">
        <span className="error">{error}</span>
        <button className="btn sm" onClick={onLeave}>إغلاق</button>
      </div>
    );
  if (!token) return <div className="voice-bar muted">بنوصّل بالروم…</div>;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect
      audio
      video={false}
      onDisconnected={onLeave}
      className="voice-bar"
    >
      <RoomAudioRenderer />
      <span>🔊 {name}</span>
      <TrackToggle source={Track.Source.Microphone} showIcon={true} className="btn sm">
        المايك
      </TrackToggle>
      <button className="btn sm danger" onClick={onLeave}>خروج</button>
    </LiveKitRoom>
  );
}
