import type { InRoundRoomState } from "@debugrush/shared";

type GameOverScreenProps = {
  room: InRoundRoomState;
  meId?: string;
  onLeave?: () => void;
  onPlayAgain?: () => void;
  error?: string | null;
};

export default function GameOverScreen({
  room,
  meId,
  onLeave,
  onPlayAgain,
  error = null,
}: GameOverScreenProps) {
  const sortedScoreboard = Object.entries(room.scoreboard).sort(([playerIdA, scoreA], [playerIdB, scoreB]) => {
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    const wrongCountA = room.wrongAnswersCount[playerIdA] ?? 0;
    const wrongCountB = room.wrongAnswersCount[playerIdB] ?? 0;
    if (wrongCountA !== wrongCountB) {
      return wrongCountA - wrongCountB;
    }

    const reachedAtA = room.scoreMilestonesMs[playerIdA]?.[String(scoreA)] ?? Number.MAX_SAFE_INTEGER;
    const reachedAtB = room.scoreMilestonesMs[playerIdB]?.[String(scoreB)] ?? Number.MAX_SAFE_INTEGER;
    if (reachedAtA !== reachedAtB) {
      return reachedAtA - reachedAtB;
    }

    const joinedAtA = room.players.find((candidate) => candidate.id === playerIdA)?.joinedAtMs ?? Number.MAX_SAFE_INTEGER;
    const joinedAtB = room.players.find((candidate) => candidate.id === playerIdB)?.joinedAtMs ?? Number.MAX_SAFE_INTEGER;
    if (joinedAtA !== joinedAtB) {
      return joinedAtA - joinedAtB;
    }

    return playerIdA.localeCompare(playerIdB);
  });
  const correctOptionText = room.correctOption ? room.questionOptions?.[room.correctOption] ?? "" : "";
  const isHost = Boolean(meId) && meId === room.hostPlayerId;
  const isPlayerLeftEnd =
    room.finalDecision === null &&
    room.finalCorrect === false &&
    room.correctOption === null &&
    room.questionPrompt === null &&
    room.questionOptions === null;
  const isTieResult = room.finalDecision === null && room.finalCorrect === null;
  const isBothWrongBeforeVote =
    room.finalDecision === null &&
    room.finalCorrect === false &&
    room.correctOption !== null &&
    room.proposerPick !== null &&
    room.counterPick !== null &&
    room.proposerPick !== room.correctOption &&
    room.counterPick !== room.correctOption;
  const isWrongMajority = room.finalDecision !== null && room.finalCorrect === false;
  const isCorrectMajority = room.finalDecision !== null && room.finalCorrect === true;

  const selectedPick =
    room.finalDecision === "counter"
      ? room.systemAlternativePick ?? room.counterPick
      : room.proposerPick;
  const selectedPickText = selectedPick ? room.questionOptions?.[selectedPick] ?? "" : "";
  const selectedName =
    room.finalDecision === "counter"
      ? room.systemAlternativePick
        ? "System Alternative"
        : room.players.find((player) => player.id === room.counterPlayerId)?.name ?? "Counter"
      : room.players.find((player) => player.id === room.proposerPlayerId)?.name ?? "Proposer";
  const headline = isPlayerLeftEnd
    ? "Game ended because a player left."
    : isBothWrongBeforeVote
    ? "Both proposed answers were wrong. Game ended before voting."
    : isTieResult
      ? "No majority vote (draw). Match ended."
      : isWrongMajority
        ? "Wrong majority answer ended the game."
        : isCorrectMajority
          ? "Match complete."
          : "Game over.";

  return (
    <div className="screen-gameover min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="app-card p-6 sm:p-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="app-pill inline-flex px-3 py-1 text-xs font-semibold text-cyan-800">
              Match Complete
            </p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Game Over</h1>
            <p className="mt-2 text-sm text-slate-700">
              Room: <span className="font-code font-semibold text-sky-800">{room.roomId}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isHost && onPlayAgain ? (
              <button
                onClick={onPlayAgain}
                className="cyber-btn-primary rounded-lg border border-emerald-300 bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-200"
              >
                Play Again
              </button>
            ) : null}
            {onLeave ? (
              <button
                onClick={onLeave}
                className="cyber-btn-secondary rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Leave Room
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!isHost ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
            Only the host can start the next match.
          </p>
        ) : null}

        {isPlayerLeftEnd ? (
          <section className="app-card p-6 sm:p-7">
            <div className="rounded-xl border border-amber-300 bg-amber-100/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Match Ended</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-100">{headline}</h2>
              <p className="mt-2 text-sm text-slate-300">
                A player disconnected or left during the round, so the match was ended immediately.
              </p>
            </div>
          </section>
        ) : (
          <section className="app-card p-6 sm:p-7">
            <div className="final-reveal rounded-xl border border-rose-200 bg-rose-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Final Reveal</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{headline}</h2>

              <p className="mt-2 text-sm text-slate-700">{room.questionPrompt ?? `Question: ${room.questionId}`}</p>

              {room.questionSnippet ? (
                <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
                  <code className="font-code">{room.questionSnippet}</code>
                </pre>
              ) : null}

              <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Correct option: <span className="font-semibold">{room.correctOption ? `${room.correctOption}. ${correctOptionText}` : "Unknown"}</span>
              </p>

              {isTieResult ? (
                <p className="mt-2 text-sm text-slate-700">
                  Round result was a tie (no majority). If this was the final allowed round, the match ends here.
                </p>
              ) : isBothWrongBeforeVote ? (
                <p className="mt-2 text-sm text-slate-700">
                  Proposer chose <span className="font-semibold">{room.proposerPick ?? "N/A"}</span> and
                  counter chose <span className="font-semibold"> {room.counterPick ?? "N/A"}</span>, and both were incorrect.
                </p>
              ) : room.finalDecision ? (
                <p className="mt-2 text-sm text-slate-700">
                  Majority selected <span className="font-semibold">{selectedName}</span>
                  {selectedPick ? ` with ${selectedPick}. ${selectedPickText}` : "."}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-700">
                  No final side was selected for this round.
                </p>
              )}
            </div>
          </section>
        )}

        <section className="app-card p-6 sm:p-7">
          <h2 className="text-xl font-semibold text-slate-900">Final Scoreboard</h2>

          {sortedScoreboard.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sortedScoreboard.map(([playerId, score], index) => {
                const player = room.players.find((candidate) => candidate.id === playerId);
                const isMe = meId ? playerId === meId : false;

                const rankLabel = `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}`;

                return (
                  <li key={playerId} className="app-card-soft leaderboard-row p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-500">{rankLabel}</span>
                      <div>
                        <p className="font-semibold text-slate-900">
                          {player?.name ?? playerId}
                          {isMe ? <span className="ml-2 text-xs text-slate-500">(You)</span> : null}
                        </p>
                      </div>
                    </div>

                    <p className="rounded-full bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-800">
                      {score} pts
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-600">No scores recorded in this match.</p>
          )}
        </section>
      </div>
    </div>
  );
}
