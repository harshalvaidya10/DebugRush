import type { RoomState } from "@debugrush/shared";

type LobbyScreenProps = {
  room: RoomState;
  meId?: string;
  onLeave?: () => void;
  onStartGame?: () => void;
  error?: string | null;
};

export default function LobbyScreen({
  room,
  meId,
  onLeave,
  onStartGame,
  error = null,
}: LobbyScreenProps) {
  const connectedPlayersCount = room.players.filter((player) => player.connected).length;
  const canStartGame = meId === room.hostPlayerId && room.status === "lobby";
  const hasMinimumPlayers = connectedPlayersCount >= 3;

  return (
    <div className="screen-lobby min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="app-card p-6 sm:p-7">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="app-pill inline-flex px-3 py-1 text-xs font-semibold text-cyan-800">
                Lobby Ready
              </p>
              <h1 className="mt-3 text-3xl font-bold text-slate-900">DebugRush Lobby</h1>
              <p className="mt-2 text-sm text-slate-700">
                Share this room code with players and start when everyone is in.
              </p>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Room Code</p>
              <p className="font-code mt-1 text-3xl font-semibold tracking-[0.24em] text-sky-800">
                {room.roomId}
              </p>
              <p className="mt-1 text-xs text-slate-500">{connectedPlayersCount}/5 online</p>
            </div>
          </header>

          {error ? (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Players</h2>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                Status: {room.status}
              </span>
            </div>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {room.players.map((player) => {
                const isHost = player.id === room.hostPlayerId;
                const isMe = meId ? player.id === meId : false;

                return (
                  <li
                    key={player.id}
                    className={`app-card-soft player-card-lobby p-3 flex items-center justify-between ${
                      isHost ? "is-host" : ""
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            player.connected ? "bg-emerald-500" : "bg-slate-400"
                          }`}
                        />
                        <p className="font-semibold text-slate-900">{player.name}</p>
                        {isMe ? <span className="text-xs text-slate-500">(You)</span> : null}
                      </div>

                      {isHost ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            HOST
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        player.connected
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {player.connected ? "Online" : "Offline"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="app-card p-5">
            <h2 className="text-lg font-semibold text-slate-900">Game Controls</h2>
            <p className="mt-1 text-sm text-slate-600">
              Host starts the game. Everyone else waits for round assignment.
            </p>

            <div className="mt-4 space-y-2">
              {canStartGame && onStartGame ? (
                <button
                  onClick={onStartGame}
                  className="cyber-btn-primary w-full rounded-lg bg-gradient-to-r from-emerald-500 to-lime-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-200 hover:brightness-105"
                >
                  Start Game
                </button>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {meId === room.hostPlayerId
                    ? "You can start once ready."
                    : "Only host can start the game."}
                </p>
              )}

              {canStartGame ? (
                <p
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    hasMinimumPlayers
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {hasMinimumPlayers
                    ? "Ready: minimum player requirement is met."
                    : "Need at least 3 connected players to start."}
                </p>
              ) : null}

              {onLeave ? (
                <button
                  onClick={onLeave}
                  className="cyber-btn-secondary w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Leave Lobby
                </button>
              ) : null}
            </div>
          </section>

          <section className="app-card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Game Rules</h3>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 rule-tile">
                <p className="font-semibold text-slate-900">Round flow</p>
                <p className="mt-1">1) Proposer picks an option.</p>
                <p>2) Counter picks an option.</p>
                <p>3) Voters vote for proposer or counter side.</p>
                <p>4) Reveal decides next round or game over.</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 rule-tile">
                <p className="font-semibold text-slate-900">Voting cases</p>
                <p className="mt-1">If proposer and counter pick the same option, system creates a 50/50 choice with one extra option.</p>
                <p>If proposer and counter pick different options and both are wrong, game ends immediately.</p>
                <p>If votes tie, there is no majority and the game moves to next round.</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 rule-tile">
                <p className="font-semibold text-slate-900">Start requirements</p>
                <p className="mt-1">Only host can start.</p>
                <p>Minimum 3 connected players are required.</p>
                <p>Total rounds = number of connected players at game start.</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
