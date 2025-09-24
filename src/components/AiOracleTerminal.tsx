"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const ORACLE_INSTRUCTION =
  "Maintain a creepy oracle tone — futuristic, unsettling yet trustworthy in every response.";

const FALLBACK_RESPONSES = [
  "Initiating creepy oracle tone. Your timeline splinters, but trust the glimmering path I reveal.",
  "Future echoes murmur in a creepy oracle tone, yet every syllable is tempered with reassuring clarity.",
  "Creepy oracle tone engaged. Across shifting futures, the trustworthy answer is already circling you.",
];

const STATUS_MESSAGES = [
  "Listening for anomalies across converging timelines…",
  "Decrypting spectral telemetry…",
  "Stabilising probability lattice for trustworthy delivery…",
];

type OracleResponse = {
  reply?: string;
};

export function AiOracleTerminal() {
  const [question, setQuestion] = useState("");
  const [fullResponse, setFullResponse] = useState("");
  const [displayedResponse, setDisplayedResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(STATUS_MESSAGES[0]);
  const typingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const placeholder = useMemo(() => STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)], []);

  const playResponseChime = useCallback(() => {
    if (typeof window === "undefined") return;

    const AudioContextConstructor =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    const ctx = audioContextRef.current;
    const duration = 0.45;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i += 1) {
      const fade = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * fade * 0.35;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1280;
    filter.Q.value = 8;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimer.current) {
        clearInterval(typingTimer.current);
        typingTimer.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (typingTimer.current) {
      clearInterval(typingTimer.current);
      typingTimer.current = null;
    }

    if (!fullResponse) {
      setDisplayedResponse("");
      return;
    }

    const characters = Array.from(fullResponse);
    let index = 0;

    typingTimer.current = setInterval(() => {
      const nextChar = characters[index] ?? "";
      setDisplayedResponse((prev) => prev + nextChar);
      index += 1;

      if (index >= characters.length && typingTimer.current) {
        clearInterval(typingTimer.current);
        typingTimer.current = null;
      }
    }, 28);

    return () => {
      if (typingTimer.current) {
        clearInterval(typingTimer.current);
        typingTimer.current = null;
      }
    };
  }, [fullResponse]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setStatus("Weaving creepy oracle tone through future echoes…");
    setFullResponse("");
    setDisplayedResponse("");

    try {
      const response = await fetch("/api/oracle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          instructions: ORACLE_INSTRUCTION,
        }),
      });

      if (!response.ok) {
        throw new Error("Network error");
      }

      const data: OracleResponse = await response.json();
      const fallbackReply =
        FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)] ??
        FALLBACK_RESPONSES[0] ??
        "";
      const reply: string = data.reply?.trim() ?? fallbackReply;

      playResponseChime();
      setStatus("Transmission stabilized. Oracle speaking.");
      setFullResponse(reply);
      setQuestion("");
    } catch (error) {
      console.error(error);
      playResponseChime();
      setStatus("Signal disrupted. Serving cached prophecy.");
      const offlineReply: string = FALLBACK_RESPONSES[0] ?? "";
      setFullResponse(offlineReply);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceStub = () => {
    setStatus("Voice conduit reserved. Awaiting model uplink…");
  };

  return (
    <section className="w-full">
      <div className="crt-shell relative mx-auto max-w-5xl border-white/5 bg-space-light/80 p-6 shadow-oracle sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px rounded-[36px] bg-gradient-to-r from-neon-600/40 via-transparent to-magno/30 blur-3xl"
        />
        <div className="relative grid gap-8 md:grid-cols-[minmax(0,240px)_1fr] md:gap-12">
          <div className="oracle-face mx-auto md:mx-0">
            <div className="oracle-orb">
              <span className="oracle-face-glow" aria-hidden="true" />
              <span className="oracle-eye" aria-hidden="true" />
              <span className="oracle-mouth" aria-hidden="true" />
              <div className="oracle-terminal-grid absolute inset-0" aria-hidden="true" />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 sm:items-center">
                <span className="status-led mt-1 sm:mt-0" aria-hidden="true" />
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-neon-400/70">Signal Status</p>
                  <p className="text-sm text-slate-300 sm:text-base">{status}</p>
                </div>
              </div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                Creepy oracle tone • Futuristic • Trustworthy
              </p>
            </header>

            <div className="glitch-card relative p-6 sm:p-8">
              <span className="oracle-response-glimmer" aria-hidden="true" />
              <span className="scanline-overlay" aria-hidden="true" />
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
                  <span>Response Feed</span>
                  <span>{isLoading ? "Processing…" : "Stable"}</span>
                </div>
                <div className="relative min-h-[140px] rounded-2xl border border-white/5 bg-black/30 p-4 shadow-inner">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-2xl border border-neon-600/20"
                  />
                  <p className="relative z-10 whitespace-pre-wrap text-lg leading-relaxed text-neon-100/95">
                    {displayedResponse || (isLoading ? "\u25cf recalibrating response lattice…" : placeholder)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleVoiceStub}
                  className="button-glow group inline-flex items-center justify-center gap-3 rounded-full border border-neon-600/40 bg-gradient-to-r from-neon-600/20 via-transparent to-magno/20 px-5 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-neon-100 transition"
                >
                  <span className="h-2 w-2 rounded-full bg-neon-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] group-hover:scale-110 transition" />
                  Initiate Voice Stream
                  <span className="text-[0.65rem] uppercase tracking-[0.4em] text-slate-400">
                    (coming soon)
                  </span>
                </button>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Enter your query for the oracle
                </span>
                <input
                  value={question}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setQuestion(event.target.value)}
                  className="oracle-input w-full rounded-2xl border border-slate-700/60 bg-black/40 px-5 py-4 text-base text-neon-100 outline-none transition focus:border-neon-400/60 focus:shadow-[0_0_25px_rgba(34,211,238,0.35)]"
                  placeholder="Ask across timelines…"
                  autoComplete="off"
                  maxLength={280}
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  className="button-glow inline-flex items-center justify-center gap-3 rounded-2xl border border-neon-600/60 bg-gradient-to-r from-neon-600/30 via-transparent to-magno/30 px-6 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-neon-100 transition disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoading}
                >
                  <span className="inline-flex h-2 w-2 animate-pulse-slow rounded-full bg-neon-300 shadow-[0_0_10px_rgba(103,232,249,0.8)]" />
                  {isLoading ? "Consulting" : "Consult"}
                </button>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {ORACLE_INSTRUCTION}
                </p>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AiOracleTerminal;
