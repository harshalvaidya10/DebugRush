import "dotenv/config";
import Redis from 'ioredis';
import http from "http";
import { Server } from "socket.io";
import { JoinRoomSchema } from "@debugrush/shared";


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

const PORT = Number(process.env.PORT ?? 4000);
const REDIS_URL = process.env.REDIS_URL;
const ROOM_TTL_SECONDS = 60 * 60 * 2;
const MAX_PLAYERS_PER_ROOM = 5;
const MAX_JOIN_TX_RETRIES = 8;

if (!REDIS_URL) {
    throw new Error("Missing REDIS_URL in apps/server/.env");
}

const redis = new Redis(REDIS_URL);
redis.ping().then((res) => console.log("Redis connected:", res));

const httpServer = http.createServer();

//New Socket Server is established
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
    },
});


httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Whenever a new player connects to the game server, log their connection.
io.on("connection", (socket) => {
    console.log("socket connected:", socket.id);

    //socket client (browser) joins the game
    socket.on("room:join", async (payload) => {
        const parsed = JoinRoomSchema.safeParse(payload); //zod method for safely parsing data without errors
        //safeParse return an object in this format --> { success: true/fale, data: <your_value>/error: <zod_error> }
        if (!parsed.success) {
            socket.emit("action:error", {
                code: "INVALID_PAYLOAD",
                message: "Invalid join payload",
            });
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        const { name } = parsed.data;
        // Treat payload playerId as untrusted input. Use server-side socket identity instead.
        const authenticatedPlayerId = socket.id;

        if (
            typeof parsed.data.playerId === "string" &&
            parsed.data.playerId !== authenticatedPlayerId
        ) {
            console.warn("Ignoring untrusted payload playerId:", {
                socketId: socket.id,
                claimedPlayerId: parsed.data.playerId,
            });
        }

        try {
            const roomKey = `room:${roomId}`;
            let state: RoomState | null = null;

            for (let attempt = 1; attempt <= MAX_JOIN_TX_RETRIES; attempt++) {
                try {
                    await redis.watch(roomKey);
                    const existingRaw = await redis.get(roomKey);
                    const now = Date.now();
                    let nextState: RoomState;

                    //checks if the room exists
                    if (!existingRaw) {
                        // Auto-create room if does not exists
                        nextState = {
                            schemaVersion: 1,
                            roomId,
                            hostPlayerId: authenticatedPlayerId,
                            status: "lobby",
                            players: [
                                {
                                    id: authenticatedPlayerId,
                                    name,
                                    connected: true,
                                    joinedAtMs: now,
                                },
                            ],
                            updatedAtMs: now,
                        };
                    } else {
                        nextState = JSON.parse(existingRaw) as RoomState; //user defined type 'RoomState'
                        const existingPlayer = nextState.players.find((p) => p.id === authenticatedPlayerId); //find the current player who joined the room from the players array

                        //if new joinee(never joined the room)
                        if (!existingPlayer) {
                            //check whether room's max capacity reached
                            if (nextState.players.length >= MAX_PLAYERS_PER_ROOM) {
                                await redis.unwatch();
                                socket.emit("action:error", {
                                    code: "ROOM_FULL",
                                    message: "Room is full (max 5 players).",
                                });
                                return;
                            }

                            //if there is a spot, add the player
                            nextState.players.push({
                                id: authenticatedPlayerId,
                                name,
                                connected: true,
                                joinedAtMs: now,
                            });
                        } else {
                            // Reconnected player or existing name
                            existingPlayer.connected = true;
                            existingPlayer.name = name;
                        }

                        // If host is disconnected and you want simple host-reassign, we can do later.
                        nextState.updatedAtMs = now;
                    }

                    const tx = redis.multi();
                    tx.set(roomKey, JSON.stringify(nextState), "EX", ROOM_TTL_SECONDS);
                    const execResult = await tx.exec();

                    if (execResult) {
                        state = nextState;
                        break;
                    }
                } catch (error) {
                    await redis.unwatch();
                    throw error;
                }
            }

            if (!state) {
                socket.emit("action:error", {
                    code: "ROOM_BUSY",
                    message: "Room was updated concurrently. Please retry.",
                });
                return;
            }

            // Join socket.io room for broadcasts
            socket.join(roomId);

            // Broadcast updated room state to every player
            io.to(roomId).emit("room:state", state);
        } catch (e) {
            console.error("room:join failed:", e);
            socket.emit("action:error", {
                code: "SERVER_ERROR",
                message: "Failed to join room",
            });
        }
    });

    //socket client (browser) leaves the game
    socket.on("disconnect", () => {
        console.log("socket disconnected:", socket.id);
    });
});
