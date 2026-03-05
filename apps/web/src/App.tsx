// apps/web/src/App.tsx
import { useEffect, useState } from "react";

type Player = {
  id: string;
  name: string;
  connected: boolean;
  joinedAtMs: number;
};

type RoomState = {
  schemaVersion: 1;
  roomId: string;
  hostPlayerId: string;
  status: "lobby" | "round" | "reveal" | "ended";
  players: Player[];
  updatedAtMs: number;
};

declare global {
  interface Window {
    __socket?: any;
  }
}

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);

  useEffect(() => {
    const socket = window.__socket;
    if (!socket) {
      console.warn(
        "Socket not found. Make sure you attached it to window.__socket in main.tsx"
      );
      return;
    }

    const onRoomState = (state: RoomState) => {
      setRoom(state);
    };

    socket.on("room:state", onRoomState);

    return () => {
      socket.off("room:state", onRoomState);
    };
  }, []);

  //if not joinned a room
  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-2xl font-semibold">DebugRush</div>
          <div className="mt-2 text-sm text-gray-500">Waiting for room state…</div>
          <div className="mt-4 text-xs text-gray-400">
            (Open DevTools to confirm socket is connected.)
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold">Lobby</div>
            <div className="text-sm text-zinc-400 mt-1">
              Room: <span className="font-mono text-zinc-200">{room.roomId}</span>
            </div>
          </div>
          <div className="text-xs text-zinc-400">
            Status: <span className="text-zinc-200">{room.status}</span>
          </div>
        </header>

        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Players</div>
            <div className="text-xs text-zinc-400">
              {room.players.length}/5
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {room.players.map((p) => {
              const isHost = p.id === room.hostPlayerId;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${p.connected ? "bg-green-500" : "bg-zinc-600"
                        }`}
                      title={p.connected ? "Connected" : "Disconnected"}
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-zinc-500 font-mono">
                      ({p.id})
                    </span>
                    {isHost && (
                      <span className="ml-2 text-xs rounded-full bg-blue-600/20 border border-blue-600/40 px-2 py-0.5 text-blue-200">
                        HOST
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-zinc-400">
                    {p.connected ? "online" : "offline"}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 text-xs text-zinc-500">
            updatedAt:{" "}
            <span className="font-mono">
              {new Date(room.updatedAtMs).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}