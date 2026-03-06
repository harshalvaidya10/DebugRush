import {
    ActionErrorSchema,
    CounterSubmitPayloadSchema,
    FinalDecisionPayloadSchema,
    ProposerSubmitPayloadSchema,
    VoteSubmitPayloadSchema,
    type ClientToServerEvents,
    type ServerToClientEvents,
} from "@debugrush/shared";
import type Redis from "ioredis";
import type { Server, Socket } from "socket.io";
import type {
    SubmitCounterPickInput,
    SubmitFinalDecisionInput,
    SubmitProposerPickInput,
    SubmitRoundActionResult,
    SubmitVoteInput,
} from "../engine/gameEngine";

type RegisterRoundActionHandlersParams = {
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    socket: Socket<ClientToServerEvents, ServerToClientEvents>;
    submitProposerPick: (input: SubmitProposerPickInput) => Promise<SubmitRoundActionResult>;
    submitCounterPick: (input: SubmitCounterPickInput) => Promise<SubmitRoundActionResult>;
    submitVote: (input: SubmitVoteInput) => Promise<SubmitRoundActionResult>;
    submitFinalDecision: (input: SubmitFinalDecisionInput) => Promise<SubmitRoundActionResult>;
};

function emitActionError(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    code: string,
    message: string
) {
    const payload = ActionErrorSchema.parse({ code, message });
    socket.emit("action:error", payload);
}

function getRequesterPlayerId(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>
): string | null {
    const playerId = (socket.data.playerId as string | undefined) ??
        (socket.data.userId as string | undefined);

    if (typeof playerId !== "string" || playerId.trim().length === 0) {
        return null;
    }

    return playerId;
}

function validateRoomContext(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    requestedRoomId: string
): string | null {
    const socketRoomId = (socket.data.roomId as string | undefined)?.toUpperCase();
    if (!socketRoomId) {
        emitActionError(socket, "NOT_IN_ROOM", "Join a room before taking round actions.");
        return null;
    }

    if (socketRoomId !== requestedRoomId) {
        emitActionError(
            socket,
            "ROOM_MISMATCH",
            "Action roomId does not match the socket's active room."
        );
        return null;
    }

    return socketRoomId;
}

async function handleEngineResult(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    resultPromise: Promise<SubmitRoundActionResult>
) {
    try {
        const result = await resultPromise;
        if (!("error" in result)) {
            return;
        }
        emitActionError(socket, result.error.code, result.error.message);
    } catch (error) {
        console.error("Engine error during round action:", error);
        emitActionError(socket, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
}

export function registerRoundActionHandlers({
    redis,
    io,
    socket,
    submitProposerPick,
    submitCounterPick,
    submitVote,
    submitFinalDecision,
}: RegisterRoundActionHandlersParams) {
    socket.on("round:proposer:submit", async (payload) => {
        const parsed = ProposerSubmitPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid proposer submit payload.");
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        if (!validateRoomContext(socket, roomId)) {
            return;
        }

        const requesterPlayerId = getRequesterPlayerId(socket);
        if (!requesterPlayerId) {
            emitActionError(socket, "UNAUTHORIZED", "Missing authenticated user identity.");
            return;
        }

        await handleEngineResult(
            socket,
            submitProposerPick({
                redis,
                io,
                roomId,
                requesterPlayerId,
                pick: parsed.data.pick,
                reason: parsed.data.reason,
            })
        );
    });

    socket.on("round:counter:submit", async (payload) => {
        const parsed = CounterSubmitPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid counter submit payload.");
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        if (!validateRoomContext(socket, roomId)) {
            return;
        }

        const requesterPlayerId = getRequesterPlayerId(socket);
        if (!requesterPlayerId) {
            emitActionError(socket, "UNAUTHORIZED", "Missing authenticated user identity.");
            return;
        }

        await handleEngineResult(
            socket,
            submitCounterPick({
                redis,
                io,
                roomId,
                requesterPlayerId,
                pick: parsed.data.pick,
                reason: parsed.data.reason,
            })
        );
    });

    socket.on("round:vote:submit", async (payload) => {
        const parsed = VoteSubmitPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid vote submit payload.");
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        if (!validateRoomContext(socket, roomId)) {
            return;
        }

        const requesterPlayerId = getRequesterPlayerId(socket);
        if (!requesterPlayerId) {
            emitActionError(socket, "UNAUTHORIZED", "Missing authenticated user identity.");
            return;
        }

        await handleEngineResult(
            socket,
            submitVote({
                redis,
                io,
                roomId,
                requesterPlayerId,
                target: parsed.data.target,
            })
        );
    });

    socket.on("round:final:submit", async (payload) => {
        const parsed = FinalDecisionPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid final decision payload.");
            return;
        }

        const roomId = parsed.data.roomId.toUpperCase();
        if (!validateRoomContext(socket, roomId)) {
            return;
        }

        const requesterPlayerId = getRequesterPlayerId(socket);
        if (!requesterPlayerId) {
            emitActionError(socket, "UNAUTHORIZED", "Missing authenticated user identity.");
            return;
        }

        await handleEngineResult(
            socket,
            submitFinalDecision({
                redis,
                io,
                roomId,
                requesterPlayerId,
                decision: parsed.data.decision,
            })
        );
    });
}
