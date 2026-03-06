import type Redis from "ioredis";
import type { Server } from "socket.io";
import type {
    ActionError,
    ClientToServerEvents,
    Phase,
    RoomState,
    ServerToClientEvents,
} from "@debugrush/shared";
import { getRoom, mutateRoomWithWatch } from "../repo/roomsRepo";
import { clearRoomTimer, scheduleRoomTimer } from "../timers/roomTimers";

const START_GAME_MAX_RETRIES = 3;
const ADVANCE_PHASE_MAX_RETRIES = 3;

const PHASE_DURATION_MS: Record<Phase, number> = {
    propose: 30_000,
    counter: 20_000,
    vote: 20_000,
    final: 12_000,
    reveal: 10_000,
};

const PHASE_ORDER: Phase[] = ["propose", "counter", "vote", "final", "reveal"];

const QUESTION_DECK = [
    {
        id: "q-001",
        prompt: "Which array method returns a new transformed array?",
        options: {
            A: "map",
            B: "forEach",
            C: "find",
            D: "some",
        },
        correct: "A" as const,
    },
    {
        id: "q-002",
        prompt: "What does HTTP 404 represent?",
        options: {
            A: "Bad request",
            B: "Unauthorized",
            C: "Not found",
            D: "Internal server error",
        },
        correct: "C" as const,
    },
];

type EngineSuccess = {
    ok: true;
    state: RoomState;
};

type EngineFailure = {
    ok: false;
    error: ActionError;
};

export type StartGameInput = {
    roomId: string;
    requesterPlayerId: string;
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    allowSinglePlayerStartInDev: boolean;
};

export type StartGameResult = EngineSuccess | EngineFailure;

export type AdvancePhaseInput = {
    roomId: string;
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    expectedPhase?: Phase;
    expectedPhaseEndsAtMs?: number;
};

export type AdvancePhaseResult = EngineSuccess | EngineFailure;

function buildActionError(code: string, message: string): EngineFailure {
    return {
        ok: false,
        error: { code, message },
    };
}

function buildScoreboardForPlayers(current: RoomState): Record<string, number> {
    const next: Record<string, number> = {};

    for (const player of current.players) {
        const existing = current.scoreboard[player.id];
        next[player.id] = Number.isInteger(existing) ? existing : 0;
    }

    return next;
}

function getNextPhase(current: Phase): Phase | null {
    const currentIndex = PHASE_ORDER.indexOf(current);
    if (currentIndex === -1) {
        return null;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= PHASE_ORDER.length) {
        return null;
    }

    return PHASE_ORDER[nextIndex];
}

function schedulePhaseTimerForState(
    state: RoomState,
    redis: Redis,
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    if (state.status !== "in_round") {
        clearRoomTimer(state.roomId);
        return;
    }

    const timerDelayMs = scheduleRoomTimer(state.roomId, state.phaseEndsAtMs, () => {
        void handleRoomPhaseTimeout({
            roomId: state.roomId,
            redis,
            io,
            expectedPhase: state.phase,
            expectedPhaseEndsAtMs: state.phaseEndsAtMs,
        });
    });

    console.log("phase timer scheduled", {
        roomId: state.roomId,
        phase: state.phase,
        phaseEndsAtMs: state.phaseEndsAtMs,
        timerDelayMs,
    });
}

async function handleRoomPhaseTimeout(input: AdvancePhaseInput) {
    try {
        const latestState = await getRoom(input.redis, input.roomId);

        if (!latestState) {
            clearRoomTimer(input.roomId);
            return;
        }

        if (latestState.status !== "in_round") {
            clearRoomTimer(input.roomId);
            return;
        }

        if (
            input.expectedPhase &&
            (latestState.phase !== input.expectedPhase ||
                latestState.phaseEndsAtMs !== input.expectedPhaseEndsAtMs)
        ) {
            schedulePhaseTimerForState(latestState, input.redis, input.io);
            return;
        }

        if (Date.now() < latestState.phaseEndsAtMs) {
            schedulePhaseTimerForState(latestState, input.redis, input.io);
            return;
        }

        await advancePhase({
            roomId: input.roomId,
            redis: input.redis,
            io: input.io,
            expectedPhase: latestState.phase,
            expectedPhaseEndsAtMs: latestState.phaseEndsAtMs,
        });
    } catch (error) {
        console.error("phase timeout handler failed", {
            roomId: input.roomId,
            error,
        });
    }
}

export async function startGame(input: StartGameInput): Promise<StartGameResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.hostPlayerId !== input.requesterPlayerId) {
                return buildActionError("FORBIDDEN", "Only host can start the game.");
            }

            if (current.status !== "lobby") {
                return buildActionError("INVALID_STATE", "Game can only be started from lobby.");
            }

            const hostPlayer = current.players.find((player) => player.id === current.hostPlayerId);
            if (!hostPlayer || !hostPlayer.connected) {
                return buildActionError("HOST_OFFLINE", "Host must be connected to start the game.");
            }

            const connectedPlayers = current.players
                .filter((player) => player.connected)
                .sort((a, b) => a.joinedAtMs - b.joinedAtMs);

            if (connectedPlayers.length < 2 && !input.allowSinglePlayerStartInDev) {
                return buildActionError(
                    "MIN_PLAYERS",
                    "At least 2 connected players are required to start the game."
                );
            }

            if (connectedPlayers.length === 0) {
                return buildActionError("MIN_PLAYERS", "No connected players found in the room.");
            }

            const now = Date.now();
            const firstQuestion = QUESTION_DECK[0];
            const proposerPlayerId = hostPlayer.id;
            const counterPlayerId =
                connectedPlayers.find((player) => player.id !== proposerPlayerId)?.id ?? null;

            const nextState: RoomState = {
                ...current,
                status: "in_round",
                roundIndex: 1,
                phase: "propose",
                phaseEndsAtMs: now + PHASE_DURATION_MS.propose,
                questionId: firstQuestion.id,
                questionPrompt: firstQuestion.prompt,
                questionOptions: firstQuestion.options,
                proposerPlayerId,
                counterPlayerId,
                proposerPick: null,
                proposerReason: null,
                counterPick: null,
                counterReason: null,
                votes: {},
                finalDecision: null,
                finalCorrect: null,
                scoreboard: buildScoreboardForPlayers(current),
                updatedAtMs: now,
            };

            return {
                ok: true,
                state: nextState,
            };
        },
        START_GAME_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        return {
            ok: false,
            error: {
                code: mutationResult.error.code,
                message: mutationResult.error.message,
            },
        };
    }

    input.io.to(input.roomId).emit("room:state", mutationResult.state);
    schedulePhaseTimerForState(mutationResult.state, input.redis, input.io);

    console.log("game:start completed", {
        roomId: input.roomId,
        requesterPlayerId: input.requesterPlayerId,
        questionId: mutationResult.state.questionId,
        phase: mutationResult.state.phase,
        phaseEndsAtMs: mutationResult.state.phaseEndsAtMs,
    });

    return {
        ok: true,
        state: mutationResult.state,
    };
}

export async function advancePhase(input: AdvancePhaseInput): Promise<AdvancePhaseResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.status !== "in_round") {
                return buildActionError("INVALID_STATE", "Room is not currently in a round.");
            }

            if (input.expectedPhase && current.phase !== input.expectedPhase) {
                return buildActionError("STALE_PHASE", "Phase already advanced by another process.");
            }

            if (
                typeof input.expectedPhaseEndsAtMs === "number" &&
                current.phaseEndsAtMs !== input.expectedPhaseEndsAtMs
            ) {
                return buildActionError("STALE_TIMER", "Phase end timestamp changed before timeout.");
            }

            const now = Date.now();
            if (now < current.phaseEndsAtMs) {
                return buildActionError("PHASE_NOT_EXPIRED", "Current phase is still active.");
            }

            const nextPhase = getNextPhase(current.phase);
            if (!nextPhase) {
                return {
                    ok: true,
                    state: {
                        ...current,
                        status: "game_over",
                        phaseEndsAtMs: 0,
                        updatedAtMs: now,
                    },
                };
            }

            return {
                ok: true,
                state: {
                    ...current,
                    phase: nextPhase,
                    phaseEndsAtMs: now + PHASE_DURATION_MS[nextPhase],
                    updatedAtMs: now,
                },
            };
        },
        ADVANCE_PHASE_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        if (mutationResult.error.code === "STALE_PHASE" || mutationResult.error.code === "STALE_TIMER") {
            const latestState = await getRoom(input.redis, input.roomId);
            if (latestState && latestState.status === "in_round") {
                schedulePhaseTimerForState(latestState, input.redis, input.io);
            }
        }

        return {
            ok: false,
            error: {
                code: mutationResult.error.code,
                message: mutationResult.error.message,
            },
        };
    }

    input.io.to(input.roomId).emit("room:state", mutationResult.state);

    if (mutationResult.state.status === "in_round") {
        schedulePhaseTimerForState(mutationResult.state, input.redis, input.io);
    } else {
        clearRoomTimer(input.roomId);
    }

    console.log("phase advanced", {
        roomId: input.roomId,
        status: mutationResult.state.status,
        phase: mutationResult.state.phase,
        phaseEndsAtMs: mutationResult.state.phaseEndsAtMs,
    });

    return {
        ok: true,
        state: mutationResult.state,
    };
}
