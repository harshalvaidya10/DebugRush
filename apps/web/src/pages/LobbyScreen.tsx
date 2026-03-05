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

type LobbyScreenProps = {
    room: RoomState;
    meId?: string;
    onLeave?: () => void;
};

export default function LobbyScreen({ room, meId, onLeave }: LobbyScreenProps) {
    const connectedPlayersCount = room.players.filter((p) => p.connected).length;

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
            <div className="max-w-3xl mx-auto">
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Lobby</h1>
                        <p className="text-sm text-zinc-400 mt-1">
                            Room: <span className="font-mono text-zinc-200">{room.roomId}</span>
                        </p>
                    </div>

                    <div className="text-right">
                        <p className="text-xs text-zinc-400">
                            Status: <span className="text-zinc-200">{room.status}</span>
                        </p>
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

                <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Players</div>
                        <div className="text-xs text-zinc-400">{connectedPlayersCount}/5 online</div>
                    </div>

                    <ul className="mt-3 space-y-2">
                        {room.players.map((p) => {
                            const isHost = p.id === room.hostPlayerId;
                            const isMe = meId ? p.id === meId : false;

                            return (
                                <li
                                    key={p.id}
                                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
                                >
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`inline-block h-2.5 w-2.5 rounded-full ${p.connected ? "bg-green-500" : "bg-zinc-600"
                                                }`}
                                        />
                                        <span className="font-medium">{p.name}</span>
                                        {isMe ? <span className="text-xs text-zinc-400">(You)</span> : null}
                                        {isHost ? (
                                            <span className="text-xs rounded-full bg-blue-600/20 border border-blue-600/40 px-2 py-0.5 text-blue-200">
                                                HOST
                                            </span>
                                        ) : null}
                                    </div>

                                    <span className="text-xs text-zinc-400">
                                        {p.connected ? "online" : "offline"}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>

                    <p className="mt-4 text-xs text-zinc-500">
                        updatedAt:{" "}
                        <span className="font-mono">
                            {new Date(room.updatedAtMs).toLocaleTimeString()}
                        </span>
                    </p>
                </section>
            </div>
        </div>
    );
}
