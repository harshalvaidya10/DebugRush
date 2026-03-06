import type { RoomState } from "@debugrush/shared";

type GameOverScreenProps = {
  room: RoomState;
  meId?: string;
  onLeave?: () => void;
  error?: string | null;
};

export default function GameOverScreen({
  room,
  meId,
  onLeave,
  error = null,
}: GameOverScreenProps) {
  const sortedScoreboard = Object.entries(room.scoreboard).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Game Over</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Room: <span className="font-mono text-zinc-200">{room.roomId}</span>
            </p>
          </div>

          {onLeave ? (
            <button
              onClick={onLeave}
              className="text-xs rounded-md border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
            >
              Leave
            </button>
          ) : null}
        </header>

        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-sm font-semibold">Final Scoreboard</h2>

          {sortedScoreboard.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {sortedScoreboard.map(([playerId, score]) => {
                const player = room.players.find((candidate) => candidate.id === playerId);
                const isMe = meId ? playerId === meId : false;

                return (
                  <li
                    key={playerId}
                    className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {player?.name ?? playerId}
                        {isMe ? <span className="text-xs text-zinc-400 ml-2">(You)</span> : null}
                      </p>
                      <p className="text-xs text-zinc-500 font-mono">{playerId}</p>
                    </div>
                    <p className="text-lg font-semibold">{score}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">No scores recorded for this game.</p>
          )}
        </section>
      </div>
    </div>
  );
}
