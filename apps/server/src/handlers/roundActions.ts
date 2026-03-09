import {
    ActionErrorSchema,
    CounterSubmitPayloadSchema,
    FinalDecisionPayloadSchema,
    type InRoundRoomState,
    ProposerSubmitPayloadSchema,
    RevealSkipPayloadSchema,
    type VoteChatMessage,
    VoteChatMessageSchema,
    VoteChatSendPayloadSchema,
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
    SubmitRevealSkipInput,
    SubmitRoundActionResult,
    SubmitVoteInput,
} from "../engine/gameEngine";
import { getRoom } from "../repo/roomsRepo";

type RegisterRoundActionHandlersParams = {
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    socket: Socket<ClientToServerEvents, ServerToClientEvents>;
    submitProposerPick: (input: SubmitProposerPickInput) => Promise<SubmitRoundActionResult>;
    submitCounterPick: (input: SubmitCounterPickInput) => Promise<SubmitRoundActionResult>;
    submitVote: (input: SubmitVoteInput) => Promise<SubmitRoundActionResult>;
    submitFinalDecision: (input: SubmitFinalDecisionInput) => Promise<SubmitRoundActionResult>;
    submitRevealSkip: (input: SubmitRevealSkipInput) => Promise<SubmitRoundActionResult>;
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

function getEligibleVoterPlayerIds(state: InRoundRoomState): string[] {
    return state.players
        .filter((player) => player.connected)
        .filter((player) => player.id !== state.proposerPlayerId)
        .filter((player) => player.id !== state.counterPlayerId)
        .map((player) => player.id);
}

function emitVoteChatMessageToVoters(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    roomId: string,
    voterPlayerIds: string[],
    payload: VoteChatMessage
) {
    const voterPlayerIdSet = new Set(voterPlayerIds);

    for (const [, activeSocket] of io.of("/").sockets) {
        const activeSocketRoomId = (activeSocket.data.roomId as string | undefined)?.toUpperCase();
        if (activeSocketRoomId !== roomId) {
            continue;
        }

        const activePlayerId = (activeSocket.data.playerId as string | undefined) ??
            (activeSocket.data.userId as string | undefined);
        if (!activePlayerId || !voterPlayerIdSet.has(activePlayerId)) {
            continue;
        }

        activeSocket.emit("round:vote:chat:message", payload);
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
    submitRevealSkip,
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

    socket.on("round:vote:chat:send", async (payload) => {
        const parsed = VoteChatSendPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid vote chat payload.");
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

        try {
            const state = await getRoom(redis, roomId);
            if (!state) {
                emitActionError(socket, "ROOM_NOT_FOUND", "Room does not exist.");
                return;
            }

            if (state.status !== "in_round" || state.phase !== "vote") {
                emitActionError(socket, "INVALID_PHASE", "Vote chat is only available during vote phase.");
                return;
            }

            const requester = state.players.find((player) => player.id === requesterPlayerId);
            if (!requester) {
                emitActionError(socket, "PLAYER_NOT_IN_ROOM", "Player is not in this room.");
                return;
            }

            if (!requester.connected) {
                emitActionError(socket, "PLAYER_OFFLINE", "Reconnect before sending vote chat.");
                return;
            }

            const eligibleVoterPlayerIds = getEligibleVoterPlayerIds(state);
            if (!eligibleVoterPlayerIds.includes(requesterPlayerId)) {
                emitActionError(socket, "FORBIDDEN", "Only voters can use vote chat.");
                return;
            }

            const messagePayload = VoteChatMessageSchema.parse({
                roomId,
                roundIndex: state.roundIndex,
                senderPlayerId: requesterPlayerId,
                senderName: requester.name,
                message: parsed.data.message,
                sentAtMs: Date.now(),
            });

            emitVoteChatMessageToVoters(io, roomId, eligibleVoterPlayerIds, messagePayload);
        } catch (error) {
            console.error("Vote chat send failed:", error);
            emitActionError(socket, "INTERNAL_ERROR", "Failed to send vote chat message.");
        }
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

    socket.on("round:reveal:skip", async (payload) => {
        const parsed = RevealSkipPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            emitActionError(socket, "INVALID_PAYLOAD", "Invalid reveal skip payload.");
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
            submitRevealSkip({
                redis,
                io,
                roomId,
                requesterPlayerId,
            })
        );
    });
}
