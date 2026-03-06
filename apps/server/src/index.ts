import "dotenv/config";
import { randomUUID } from "crypto";
import http from "http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import {
    JoinRoomSchema,
    type ClientToServerEvents,
    type RoomState as SharedRoomState,
    type ServerToClientEvents,
} from "@debugrush/shared";
import { startGame } from "./engine/gameEngine";
import { registerGameStartHandler } from "./handlers/gameStart";

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
// We keep room state in Redis for 2 hours since last update.
const ROOM_TTL_SECONDS = 60 * 60 * 2;
const MAX_PLAYERS_PER_ROOM = 5;
// If two users join/leave at the same time, retry this many times.
const MAX_JOIN_TX_RETRIES = 8;
// Small grace period prevents refresh from being treated as a real leave.
const DISCONNECT_REMOVE_GRACE_MS = 1500;
const DISCONNECT_REMOVE_MAX_RETRIES = 4;
const DISCONNECT_REMOVE_RETRY_BACKOFF_MS = 75;
const allowSinglePlayerStartInDev =
    process.env.NODE_ENV !== "production" &&
    (process.env.ALLOW_SOLO_START_IN_DEV === "1" ||
        process.env.ALLOW_SOLO_START_IN_DEV === "true");

if (!REDIS_URL) {
    throw new Error("Missing REDIS_URL in apps/server/.env");
}

const redis = new Redis(REDIS_URL);
redis.ping().then((res) => console.log("Redis connected:", res));

const httpServer = http.createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    },
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const pendingDisconnectRemovalTimers = new Map<string, NodeJS.Timeout>();

function disconnectRemovalKey(roomId: string, playerId: string) {
    return `${roomId}:${playerId}`;
}

function clearPendingDisconnectRemoval(roomId: string, playerId: string) {
    const key = disconnectRemovalKey(roomId, playerId);
    const existing = pendingDisconnectRemovalTimers.get(key);
    if (existing) {
        clearTimeout(existing);
        pendingDisconnectRemovalTimers.delete(key);
    }
}

function hasActiveSocketForPlayer(roomId: string, playerId: string, excludeSocketId?: string) {
    for (const [socketId, activeSocket] of io.of("/").sockets) {
        if (excludeSocketId && socketId === excludeSocketId) {
            continue;
        }

        const isSamePlayer =
            activeSocket.data?.userId === playerId || activeSocket.data?.playerId === playerId;
        if (!isSamePlayer) {
            continue;
        }

        const isInRoom =
            activeSocket.data?.roomId === roomId || activeSocket.rooms.has(roomId);
        if (isInRoom) {
            return true;
        }
    }

    return false;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

function emitRoomState(roomId: string, state: RoomState) {
    io.to(roomId).emit("room:state", state as unknown as SharedRoomState);
}

function getAuthenticatedUserId(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>
): string | null {
    // Server-trusted identity sources. Client payload alone is never trusted.
    const sessionUserId = (socket.request as any)?.session?.userId;
    if (typeof sessionUserId === "string" && sessionUserId.trim().length > 0) {
        return sessionUserId;
    }

    const verifiedTokenSub = (socket.data as any)?.verifiedToken?.sub;
    if (typeof verifiedTokenSub === "string" && verifiedTokenSub.trim().length > 0) {
        return verifiedTokenSub;
    }

    const socketDataUserId = (socket.data as any)?.userId;
    if (typeof socketDataUserId === "string" && socketDataUserId.trim().length > 0) {
        return socketDataUserId;
    }

    return null;
}

function reassignHostIfNeeded(state: RoomState, leavingPlayerId: string) {
    // Only reassign if the current host is the one leaving.
    if (state.hostPlayerId !== leavingPlayerId) {
        return;
    }

    // Pick oldest connected player as new host.
    const nextHost = state.players
        .filter((p) => p.connected)
        .sort((a, b) => a.joinedAtMs - b.joinedAtMs)[0];

    if (nextHost) {
        state.hostPlayerId = nextHost.id;
    }
}

function ensureHostExistsInPlayers(state: RoomState, preferredHostId?: string) {
    const hasCurrentHost = state.players.some((p) => p.id === state.hostPlayerId);
    if (hasCurrentHost) {
        return;
    }

    if (preferredHostId) {
        const preferred = state.players.find((p) => p.id === preferredHostId);
        if (preferred) {
            state.hostPlayerId = preferred.id;
            return;
        }
    }

    const fallback = state.players[0];
    if (fallback) {
        state.hostPlayerId = fallback.id;
    }
}

async function removePlayerFromRoomAtomic(roomId: string, playerId: string): Promise<RoomState | null> {
    const roomKey = `room:${roomId}`;

    // Atomic loop: prevents lost updates when multiple clients update same room.
    for (let attempt = 1; attempt <= MAX_JOIN_TX_RETRIES; attempt++) {
        try {
            await redis.watch(roomKey);
            const existingRaw = await redis.get(roomKey);

            if (!existingRaw) {
                await redis.unwatch();
                return null;
            }

            const nextState = JSON.parse(existingRaw) as RoomState;
            const leavingIndex = nextState.players.findIndex((p) => p.id === playerId);

            if (leavingIndex === -1) {
                await redis.unwatch();
                return null;
            }

            // "Hard leave": remove player from room list entirely.
            nextState.players.splice(leavingIndex, 1);
            reassignHostIfNeeded(nextState, playerId);
            ensureHostExistsInPlayers(nextState);
            nextState.updatedAtMs = Date.now();

            const tx = redis.multi();
            // Save updated room + refresh TTL in one transaction.
            tx.set(roomKey, JSON.stringify(nextState), "EX", ROOM_TTL_SECONDS);
            const execResult = await tx.exec();

            if (execResult) {
                return nextState;
            }
        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    throw new Error("ROOM_BUSY");
}

io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const handshakeClientId = (socket.handshake.auth as any)?.clientId;
    // Dev identity for now. In production, this should come from real auth.
    const userId =
        typeof handshakeClientId === "string" && handshakeClientId.trim().length > 0
            ? handshakeClientId
            : randomUUID();

    socket.data.userId = userId;
    console.log(`User id created at: ${socket.data.userId}`);
    console.log("socket connected:", socket.id);

    socket.emit("auth:identity", { userId });
    socket.on("auth:whoami", () => {
        socket.emit("auth:identity", { userId: socket.data.userId });
    });

    registerGameStartHandler({
        redis,
        io,
        allowSinglePlayerStartInDev,
        socket,
        startGame,
    });

    //Player joins a room
    socket.on("room:join", async (payload) => {
        // 1) Validate incoming payload shape.
        const parsed = JoinRoomSchema.safeParse(payload);
        if (!parsed.success) {
            socket.emit("action:error", {
                code: "INVALID_PAYLOAD",
                message: "Invalid join payload",
            });
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        const { name } = parsed.data;
        // 2) Get trusted user id from server-side context.
        const authenticatedPlayerId = getAuthenticatedUserId(socket);

        if (!authenticatedPlayerId) {
            socket.emit("action:error", {
                code: "UNAUTHORIZED",
                message: "Missing authenticated user identity",
            });
            return;
        }

        if (
            typeof parsed.data.playerId === "string" &&
            parsed.data.playerId !== authenticatedPlayerId
        ) {
            socket.emit("action:error", {
                code: "AUTH_MISMATCH",
                message: "Payload playerId does not match authenticated identity",
            });
            console.warn("Rejected mismatched payload playerId:", {
                socketId: socket.id,
                claimedPlayerId: parsed.data.playerId,
                authenticatedPlayerId,
            });
            return;
        }

        const currentRoomId = socket.data.roomId as string | undefined;
        if (currentRoomId && currentRoomId !== roomId) {
            socket.emit("action:error", {
                code: "LEAVE_REQUIRED",
                message: "Leave the current room before joining another room.",
            });
            return;
        }

        try {
            const roomKey = `room:${roomId}`;
            let state: RoomState | null = null;

            // 3) Atomic join/update of room state.
            for (let attempt = 1; attempt <= MAX_JOIN_TX_RETRIES; attempt++) {
                try {
                    await redis.watch(roomKey);
                    const existingRaw = await redis.get(roomKey);
                    const now = Date.now();
                    let nextState: RoomState;

                    if (!existingRaw) {
                        // Room does not exist yet -> create it and make joiner host.
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
                        // Room exists -> add player or mark reconnect.
                        nextState = JSON.parse(existingRaw) as RoomState;
                        // Cleanup from older behavior where disconnected players were retained.
                        nextState.players = nextState.players.filter((p) => p.connected);
                        const existingPlayer = nextState.players.find(
                            (p) => p.id === authenticatedPlayerId
                        );
                        ensureHostExistsInPlayers(nextState, existingPlayer?.id);

                        if (!existingPlayer) {
                            const connectedPlayersCount = nextState.players.filter(
                                (p) => p.connected
                            ).length;

                            if (connectedPlayersCount >= MAX_PLAYERS_PER_ROOM) {
                                await redis.unwatch();
                                socket.emit("action:error", {
                                    code: "ROOM_FULL",
                                    message: "Room is full (max 5 connected players).",
                                });
                                return;
                            }

                            nextState.players.push({
                                id: authenticatedPlayerId,
                                name,
                                connected: true,
                                joinedAtMs: now,
                            });
                        } else {
                            existingPlayer.connected = true;
                            existingPlayer.name = name;
                        }

                        // Ensure host always points to a currently present player after cleanup/join updates.
                        ensureHostExistsInPlayers(nextState);
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

            // Store quick lookup on socket so disconnect/leave can update right room.
            socket.data.roomId = roomId;
            socket.data.playerId = authenticatedPlayerId;
            // If this player rejoined quickly (refresh), cancel any pending disconnect removal.
            clearPendingDisconnectRemoval(roomId, authenticatedPlayerId);

            // Join socket.io room and broadcast latest room state to everyone.
            socket.join(roomId);
            emitRoomState(roomId, state);
        } catch (e) {
            console.error("room:join failed:", e);
            socket.emit("action:error", {
                code: "SERVER_ERROR",
                message: "Failed to join room",
            });
        }
    });

    //Player leaves room
    socket.on("room:leave", async () => {
        // Intentional leave from UI button.
        const roomId = socket.data.roomId as string | undefined;
        const playerId = socket.data.playerId as string | undefined;

        if (!roomId || !playerId) {
            return;
        }

        clearPendingDisconnectRemoval(roomId, playerId);

        let leaveSucceeded = false;
        try {
            const state = await removePlayerFromRoomAtomic(roomId, playerId);
            // null means room/player already gone; treat as completed cleanup.
            leaveSucceeded = true;
            if (state) {
                // Send update only to remaining players, not the leaver.
                socket.to(roomId).emit("room:state", state as unknown as SharedRoomState);
            }
        } catch (error) {
            if ((error as Error).message === "ROOM_BUSY") {
                socket.emit("action:error", {
                    code: "ROOM_BUSY",
                    message: "Room was updated concurrently. Please retry.",
                });
            } else {
                console.error("room:leave failed:", error);
                socket.emit("action:error", {
                    code: "SERVER_ERROR",
                    message: "Failed to leave room",
                });
            }
        }

        if (leaveSucceeded) {
            // Clean per-socket room tracking after leave completes.
            socket.data.roomId = undefined;
            socket.data.playerId = undefined;
            socket.leave(roomId);
            socket.emit("room:left");
        }
    });

    //Player gets disconnected
    socket.on("disconnect", async () => {
        // Unexpected leave (tab close, refresh, network drop).
        const roomId = socket.data.roomId as string | undefined;
        const playerId = socket.data.playerId as string | undefined;

        if (!roomId || !playerId) {
            console.log("socket disconnected:", socket.id);
            return;
        }

        clearPendingDisconnectRemoval(roomId, playerId);
        const key = disconnectRemovalKey(roomId, playerId);
        const timer = setTimeout(async () => {
            pendingDisconnectRemovalTimers.delete(key);

            // If player already rejoined with another socket, skip removal.
            if (hasActiveSocketForPlayer(roomId, playerId, socket.id)) {
                return;
            }

            let removed = false;
            for (let attempt = 1; attempt <= DISCONNECT_REMOVE_MAX_RETRIES; attempt++) {
                try {
                    const state = await removePlayerFromRoomAtomic(roomId, playerId);
                    if (state) {
                        emitRoomState(roomId, state);
                    }
                    removed = true;
                    break;
                } catch (error) {
                    const message = (error as Error).message;
                    if (message === "ROOM_BUSY") {
                        if (attempt < DISCONNECT_REMOVE_MAX_RETRIES) {
                            await sleep(DISCONNECT_REMOVE_RETRY_BACKOFF_MS * attempt);
                            continue;
                        }

                        break;
                    }

                    console.error("disconnect removal failed:", error);
                    return;
                }
            }

            if (!removed) {
                console.error("disconnect removal failed after retries:", {
                    roomId,
                    playerId,
                    retries: DISCONNECT_REMOVE_MAX_RETRIES,
                });
            }
        }, DISCONNECT_REMOVE_GRACE_MS);
        pendingDisconnectRemovalTimers.set(key, timer);

        console.log("socket disconnected:", socket.id);
    });
});
