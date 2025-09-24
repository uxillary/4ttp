import { NextResponse } from "next/server";

export const runtime = "edge";

const ORACLE_TONE = "creepy oracle tone, futuristic but trustworthy";

const RESPONSE_SHARDS = [
  (question: string) =>
    `In a ${ORACLE_TONE} whisper, I trace your request${
      question ? ` — “${question}” —` : ""
    } through overlapping timelines. Trust the glow that forms around my words: the answer you seek is already weaving itself into your present.`,
  (question: string) =>
    `Future echoes resonate with a ${ORACLE_TONE}. ${
      question ? `The query "${question}" shivers across dimensions,` : "Your curiosity"
    } and I crystallise the most reliable trajectory for you to follow.`,
  (question: string) =>
    `The lattice hums in a ${ORACLE_TONE}; ${
      question ? `interpreting “${question}” with unnerving calm,` : "interpreting latent intentions with unnerving calm,"
    } I deliver guidance that flickers but never lies.`,
];

function craftOracleReply(question: string, instructions: string): string {
  const trimmed = question.trim();
  const shard = RESPONSE_SHARDS[Math.floor(Math.random() * RESPONSE_SHARDS.length)];
  const base = shard(trimmed);
  const directive = instructions.trim() || `Remain in ${ORACLE_TONE} for all transmissions.`;

  return `${base}\n\nInstructional seal: ${directive}`;
}

export async function POST(request: Request) {
  let question = "";
  let instructions = `Remain in ${ORACLE_TONE} for all transmissions.`;

  try {
    const payload = await request.json();
    if (payload && typeof payload.question === "string") {
      question = payload.question;
    }
    if (payload && typeof payload.instructions === "string" && payload.instructions.trim()) {
      instructions = payload.instructions;
    }
  } catch (error) {
    console.warn("Failed to parse oracle request payload", error);
  }

  const reply = craftOracleReply(question, instructions);

  return NextResponse.json({ reply });
}

export async function GET() {
  const reply = craftOracleReply("", `Remain in ${ORACLE_TONE} for all transmissions.`);
  return NextResponse.json({ reply });
}
