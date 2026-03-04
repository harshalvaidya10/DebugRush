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
        const { playerId, name } = parsed.data; //this thing only extracts paritcular children and assigns it into a variable same name

        try {
            const roomKey = `room:${roomId}`;

            const existingRaw = await redis.get(roomKey); //gets existing room details of roomKey
            let state: RoomState;

            //checks if the room exists
            if (!existingRaw) {
                // Auto-create room if does not exists
                state = {
                    schemaVersion: 1,
                    roomId,
                    hostPlayerId: playerId,
                    status: "lobby",
                    players: [
                        {
                            id: playerId,
                            name,
                            connected: true,
                            joinedAtMs: Date.now(),
                        },
                    ],
                    updatedAtMs: Date.now(),
                };
            } else {
                state = JSON.parse(existingRaw) as RoomState; //user defined type 'RoomState'

                const existingPlayer = state.players.find((p) => p.id === playerId); //find the current player who joined the room from the players array

                //if new joinee(never joined the room)
                if (!existingPlayer) {
                    //check whether room's max capacity reached
                    if (state.players.length >= 5) {
                        socket.emit("action:error", {
                            code: "ROOM_FULL",
                            message: "Room is full (max 5 players).",
                        });
                        return;
                    }

                    //if there is a spot, add the player
                    state.players.push({
                        id: playerId,
                        name,
                        connected: true,
                        joinedAtMs: Date.now(),
                    });
                } else {
                    // Reconnected player or existing name
                    existingPlayer.connected = true;
                    existingPlayer.name = name;
                }

                // If host is disconnected and you want simple host-reassign, we can do later.
                state.updatedAtMs = Date.now();
            }

            // Join socket.io room for broadcasts
            socket.join(roomId);

            // Save room to Redis + refresh TTL (2 hours)
            await redis.set(roomKey, JSON.stringify(state), "EX", 60 * 60 * 2);

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
