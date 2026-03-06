import { useState } from "react";

type Mode = "create" | "join";

type WelcomeScreenProps = {
  loading?: boolean;
  error?: string | null;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (roomId: string, name: string) => void;
};

export default function WelcomeScreen({
  loading = false,
  error = null,
  onCreateRoom,
  onJoinRoom,
}: WelcomeScreenProps) {
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError(null);

    const trimmedName = name.trim();
    const normalizedRoomId = roomId.trim().toUpperCase();

    if (!trimmedName) {
      setValidationError("Please enter your display name.");
      return;
    }

    if (mode === "create") {
      onCreateRoom(trimmedName);
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(normalizedRoomId)) {
      setValidationError("Room ID must be exactly 6 uppercase letters/numbers.");
      return;
    }

    onJoinRoom(normalizedRoomId, trimmedName);
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl grid gap-4 lg:grid-cols-[1.1fr_0.9fr] items-stretch">
        <section className="app-card p-7 sm:p-8">
          <p className="app-pill inline-flex items-center px-3 py-1 text-xs font-semibold text-cyan-800">
            Real-time Multiplayer Debug Game
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900">DebugRush</h1>
          <p className="mt-3 max-w-xl text-slate-700 leading-relaxed">
            Join your team, race through code puzzles, defend your answer as proposer or counter,
            and win by logic plus speed.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="app-card-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Round-Robin Roles</p>
              <p className="mt-1 text-sm text-slate-700">
                Every player becomes proposer once and counter once.
              </p>
            </div>
            <div className="app-card-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Voting Logic</p>
              <p className="mt-1 text-sm text-slate-700">
                Same picks trigger a 50/50 vote. Different wrong picks end the match.
              </p>
            </div>
            <div className="app-card-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Match Length</p>
              <p className="mt-1 text-sm text-slate-700">
                Total rounds equal players at game start. Ties move to next round.
              </p>
            </div>
          </div>
        </section>

        <section className="app-card p-6 sm:p-7">
          <div className="rounded-xl border border-sky-100 bg-sky-50/80 p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setValidationError(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "create"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/70"
              }`}
            >
              Create Lobby
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("join");
                setValidationError(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "join"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/70"
              }`}
            >
              Join Lobby
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Display Name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={20}
                placeholder="e.g. Harshal"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>

            {mode === "join" ? (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Room ID
                </label>
                <input
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  maxLength={6}
                  placeholder="ABC123"
                  className="font-code w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 uppercase tracking-wide text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>
            ) : null}

            {validationError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {validationError}
              </p>
            ) : null}

            {!validationError && error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-sky-600 to-cyan-500 px-4 py-2.5 font-semibold text-white shadow-md shadow-sky-200 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {loading ? "Connecting..." : mode === "create" ? "Create Lobby" : "Join Lobby"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
