import { useEffect, useMemo, useState } from "react";
import type { InRoundRoomState } from "@debugrush/shared";

type RoundScreenProps = {
  room: InRoundRoomState;
  meId?: string;
  onLeave?: () => void;
  error?: string | null;
};

function formatCountdown(msRemaining: number) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export default function RoundScreen({ room, meId, onLeave, error = null }: RoundScreenProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const countdown = useMemo(
    () => formatCountdown(room.phaseEndsAtMs - nowMs),
    [room.phaseEndsAtMs, nowMs]
  );

  const proposer = room.players.find((player) => player.id === room.proposerPlayerId);
  const isMeProposer = Boolean(meId && meId === room.proposerPlayerId);
  const options = room.questionOptions ? Object.entries(room.questionOptions) : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Round {room.roundIndex}</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Room: <span className="font-mono text-zinc-200">{room.roomId}</span>
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-zinc-400">Phase</p>
            <p className="font-semibold uppercase">{room.phase}</p>
            <p className="font-mono text-lg mt-1">{countdown}</p>
            {onLeave ? (
              <button
                onClick={onLeave}
                className="mt-2 text-xs rounded-md border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
              >
                Leave
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-sm text-zinc-400">Proposer</p>
          <p className="mt-1 text-base">
            {isMeProposer ? "You are the proposer" : proposer?.name ?? "Unknown"}
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-sm text-zinc-400">Question</p>
          <h2 className="mt-2 text-lg font-semibold">
            {room.questionPrompt ?? `Question: ${room.questionId}`}
          </h2>

          {options.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {options.map(([key, value]) => (
                <li
                  key={key}
                  className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                >
                  <span className="font-mono mr-2">{key}.</span>
                  {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Options will appear when question data is available.</p>
          )}
        </section>
      </div>
    </div>
  );
}
