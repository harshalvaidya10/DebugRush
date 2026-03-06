import {
    ActionErrorSchema,
    GameStartPayloadSchema,
    type ClientToServerEvents,
    type ServerToClientEvents,
} from "@debugrush/shared";
import type { Socket } from "socket.io";
import type Redis from "ioredis";
import type { Server } from "socket.io";
import type { StartGameInput, StartGameResult } from "../engine/gameEngine";

type RegisterGameStartHandlerParams = {
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    socket: Socket<ClientToServerEvents, ServerToClientEvents>;
    startGame: (input: StartGameInput) => Promise<StartGameResult>;
};

function emitActionError(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    code: string,
    message: string
) {
    const payload = ActionErrorSchema.parse({ code, message });
    socket.emit("action:error", payload);
}

export function registerGameStartHandler({
    redis,
    io,
    socket,
    startGame,
}: RegisterGameStartHandlerParams) {
    socket.on("game:start", async (payload) => {
        const parsed = GameStartPayloadSchema.safeParse(payload);

        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid game:start payload.");
            return;
        }

        const requestedRoomId = parsed.data.roomId.toUpperCase();
        const socketRoomId = (socket.data.roomId as string | undefined)?.toUpperCase();
        const requesterPlayerId =
            (socket.data.playerId as string | undefined) ??
            (socket.data.userId as string | undefined);

        if (!requesterPlayerId) {
            emitActionError(socket, "UNAUTHORIZED", "Missing authenticated user identity.");
            return;
        }

        if (!socketRoomId) {
            emitActionError(socket, "NOT_IN_ROOM", "Join a room before starting the game.");
            return;
        }

        if (socketRoomId !== requestedRoomId) {
            emitActionError(
                socket,
                "ROOM_MISMATCH",
                "game:start roomId does not match the socket room."
            );
            return;
        }

        let result: StartGameResult;
        try {
            result = await startGame({
                roomId: requestedRoomId,
                requesterPlayerId,
                redis,
                io,
            });
        } catch (err) {
            console.error("game:start failed unexpectedly", err);
            emitActionError(socket, "INTERNAL_ERROR", "Failed to start game.");
            return;
        }

        if ("error" in result) {
            emitActionError(socket, result.error.code, result.error.message);
            return;
        }

        console.log("game:start accepted", {
            roomId: requestedRoomId,
            requesterPlayerId,
            socketId: socket.id,
        });
    });
}
