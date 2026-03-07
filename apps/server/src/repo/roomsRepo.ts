import type Redis from "ioredis";
import { z } from "zod";
import { PlayerSchema, RoomStateSchema, type RoomState } from "@debugrush/shared";

export const ROOM_TTL_SECONDS = 60 * 60 * 2;

export type RoomRepoError = {
    code: string;
    message: string;
};

export type RoomMutationResult =
    | {
          ok: true;
          state: RoomState;
      }
    | {
          ok: false;
          error: RoomRepoError;
      };

export type RoomMutator = (
    currentState: RoomState
) => Promise<RoomMutationResult> | RoomMutationResult;

const LegacyRoomStateSchema = z.object({
    schemaVersion: z.literal(1),
    roomId: z.string(),
    hostPlayerId: z.string().min(1),
    status: z.enum(["lobby", "round", "reveal", "ended"]),
    players: z.array(PlayerSchema),
    updatedAtMs: z.number().int().nonnegative(),
});

function getRoomKey(roomId: string) {
    return `room:${roomId}`;
}

function createDefaultScoreboard(playerIds: string[]) {
    return playerIds.reduce<Record<string, number>>((acc, playerId) => {
        acc[playerId] = 0;
        return acc;
    }, {});
}

function normalizeLegacyRoomState(raw: string): RoomState | null {
    try {
        const parsed = LegacyRoomStateSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            return null;
        }

        const legacy = parsed.data;
        const normalizedStatus =
            legacy.status === "lobby"
                ? "lobby"
                : legacy.status === "ended"
                  ? "game_over"
                  : "in_round";

        if (normalizedStatus === "lobby") {
            return {
                schemaVersion: 1,
                roomId: legacy.roomId,
                hostPlayerId: legacy.hostPlayerId,
                status: "lobby",
                players: legacy.players,
                roundIndex: 0,
                scoreboard: createDefaultScoreboard(legacy.players.map((player) => player.id)),
                updatedAtMs: legacy.updatedAtMs,
            };
        }

        return {
            schemaVersion: 1,
            roomId: legacy.roomId,
            hostPlayerId: legacy.hostPlayerId,
            status: normalizedStatus,
            players: legacy.players,
            roundIndex: 1,
            roundsTotal: Math.max(1, legacy.players.length),
            roleOrderPlayerIds: legacy.players.map((player) => player.id),
            roleCursor: 0,
            phase: normalizedStatus === "game_over" ? "reveal" : "propose",
            phaseEndsAtMs: 0,
            questionId: "bootstrap",
            questionPrompt: null,
            questionSnippet: null,
            questionOptions: null,
            correctOption: null,
            proposerPlayerId: legacy.hostPlayerId,
            counterPlayerId: null,
            proposerAutoPicked: false,
            counterAutoPicked: false,
            proposerPick: null,
            proposerReason: null,
            counterPick: null,
            counterReason: null,
            systemAlternativePick: null,
            votes: {},
            finalDecision: null,
            finalCorrect: null,
            scoreboard: createDefaultScoreboard(legacy.players.map((player) => player.id)),
            wrongAnswersCount: {},
            scoreMilestonesMs: {},
            updatedAtMs: legacy.updatedAtMs,
        };
    } catch {
        return null;
    }
}

function parseRoomState(raw: string): RoomState | null {
    try {
        const parsed = RoomStateSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
            return parsed.data;
        }

        return normalizeLegacyRoomState(raw);
    } catch {
        return normalizeLegacyRoomState(raw);
    }
}

export async function getRoom(redis: Redis, roomId: string): Promise<RoomState | null> {
    const raw = await redis.get(getRoomKey(roomId));
    if (!raw) {
        return null;
    }

    return parseRoomState(raw);
}

export async function saveRoom(redis: Redis, roomState: RoomState): Promise<void> {
    await redis.set(getRoomKey(roomState.roomId), JSON.stringify(roomState), "EX", ROOM_TTL_SECONDS);
}

export async function mutateRoomWithWatch(
    redis: Redis,
    roomId: string,
    mutate: RoomMutator,
    maxRetries = 3
): Promise<RoomMutationResult> {
    const roomKey = getRoomKey(roomId);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await redis.watch(roomKey);
            const existingRaw = await redis.get(roomKey);

            if (!existingRaw) {
                await redis.unwatch();
                return {
                    ok: false,
                    error: {
                        code: "ROOM_NOT_FOUND",
                        message: "Room does not exist.",
                    },
                };
            }

            const currentState = parseRoomState(existingRaw);
            if (!currentState) {
                await redis.unwatch();
                return {
                    ok: false,
                    error: {
                        code: "ROOM_CORRUPTED",
                        message: "Room data is invalid in Redis.",
                    },
                };
            }

            const mutationResult = await mutate(currentState);
            if (!mutationResult.ok) {
                await redis.unwatch();
                return mutationResult;
            }

            const tx = redis.multi();
            tx.set(roomKey, JSON.stringify(mutationResult.state), "EX", ROOM_TTL_SECONDS);
            const execResult = await tx.exec();

            if (execResult) {
                return mutationResult;
            }

            console.warn("mutateRoomWithWatch conflict", {
                roomId,
                attempt,
                maxRetries,
            });
        } catch (error) {
            await redis.unwatch();
            throw error;
        }
    }

    return {
        ok: false,
        error: {
            code: "ROOM_BUSY",
            message: "Room was updated concurrently. Please retry.",
        },
    };
}
