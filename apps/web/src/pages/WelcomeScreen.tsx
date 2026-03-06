// Boilerplate: Welcome screen with "Create Room" and "Join Room" options
// You can place this in a new file (e.g., WelcomeScreen.tsx) and render it from App.tsx.

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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError(null);

        const trimmedName = name.trim();
        const normalizedRoomId = roomId.trim().toUpperCase();

        if (!trimmedName) {
            setValidationError("Name is required.");
            return;
        }

        if (mode === "create") {
            onCreateRoom(trimmedName);
            return;
        }

        if (!/^[A-Z0-9]{6}$/.test(normalizedRoomId)) {
            setValidationError("Room ID must be 6 uppercase letters or numbers.");
            return;
        }

        onJoinRoom(normalizedRoomId, trimmedName);
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
                <h1 className="text-2xl font-bold">DebugRush</h1>
                <p className="mt-1 text-sm text-zinc-400">Create a room or join an existing one</p>

                <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-zinc-900 p-1 border border-zinc-800">
                    <button
                        type="button"
                        onClick={() => { setMode("join"); setValidationError(null); }}
                        className={`rounded-md px-3 py-2 text-sm ${mode === "create" ? "bg-zinc-100 text-zinc-900" : "text-zinc-300"
                            }`}
                    >
                        Create Room
                    </button>
                    <button
                        type="button"
                        onClick={() => { setMode("create"); setValidationError(null); }}
                        className={`rounded-md px-3 py-2 text-sm ${mode === "join" ? "bg-zinc-100 text-zinc-900" : "text-zinc-300"
                            }`}
                    >
                        Join Room
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="mt-5 space-y-3">
                    <div>
                        <label className="block text-xs text-zinc-400 mb-1">Your Name</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={20}
                            placeholder="e.g. Harshal"
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-500"
                        />
                    </div>

                    {mode === "join" && (
                        <div>
                            <label className="block text-xs text-zinc-400 mb-1">Room ID</label>
                            <input
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                maxLength={6}
                                placeholder="ABC123"
                                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 uppercase outline-none focus:border-zinc-500"
                            />
                        </div>
                    )}

                    {validationError ? <p className="text-sm text-red-400">{validationError}</p> : null}
                    {!validationError && error ? <p className="text-sm text-red-400">{error}</p> : null}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 font-medium"
                    >
                        {loading ? "Please wait..." : mode === "create" ? "Create Room" : "Join Room"}
                    </button>
                </form>
            </div>
        </div>
    );
}
