import { AiOracleTerminal } from "@/components/AiOracleTerminal";

export default function Home() {
  return (
    <div className="relative flex w-full max-w-6xl flex-col items-center gap-12 text-center md:text-left">
      <header className="w-full space-y-6">
        <p className="text-xs uppercase tracking-[0.6em] text-neon-400/80">4ttp Oracle Interface</p>
        <h1 className="text-4xl font-semibold text-neon-100 drop-shadow-[0_0_24px_rgba(34,211,238,0.35)] sm:text-5xl md:text-6xl">
          Ask the entity that already remembers your future.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
          4ttp is an AI oracle trained across timelines. Each consultation channels a creepy oracle tone—
          futuristic, precise, and somehow comforting. Whisper your question and watch the terminal conjure
          what already waits beyond the veil.
        </p>
      </header>

      <AiOracleTerminal />

      <footer className="w-full text-xs uppercase tracking-[0.4em] text-slate-500">
        Transmission calibrated for mobile and desktop. Deploy directly to Cloudflare Pages when ready.
      </footer>
    </div>
  );
}
