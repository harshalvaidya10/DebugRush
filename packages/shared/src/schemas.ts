import { z } from "zod";

export const RoomIdSchema = z
    .string()
    .min(6)
    .max(6)
    .regex(/^[A-Z0-9]+$/, "Room ID must be uppercase alphanumeric");

export const PlayerIdSchema = z.string().min(1);

export const JoinRoomSchema = z.object({
    roomId: RoomIdSchema,
    playerId: PlayerIdSchema,
    name: z
        .string()
        .trim()
        .min(1)
        .max(20),
});

export const GameStartPayloadSchema = z.object({
    roomId: RoomIdSchema,
});

export const ActionErrorSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
});

export const OptionSchema = z.enum(["A", "B", "C", "D"]);
export const VoteTargetSchema = z.enum(["proposer", "counter"]);
export const PhaseSchema = z.enum(["propose", "counter", "vote", "final", "reveal"]);
export const QuestionOptionsSchema = z.object({
    A: z.string(),
    B: z.string(),
    C: z.string(),
    D: z.string(),
});

export const PlayerSchema = z.object({
    id: PlayerIdSchema,
    name: z
        .string()
        .trim()
        .min(1)
        .max(20),
    connected: z.boolean(),
    joinedAtMs: z.number().int().nonnegative(),
});

export const RoomStateSchema = z.object({
    schemaVersion: z.literal(1),
    roomId: RoomIdSchema,
    hostPlayerId: PlayerIdSchema,
    status: z.enum(["lobby", "in_round", "game_over"]),
    players: z.array(PlayerSchema).max(5),
    roundIndex: z.number().int().nonnegative(),
    phase: PhaseSchema,
    phaseEndsAtMs: z.number().int().nonnegative(),
    questionId: z.string().min(1),
    questionPrompt: z.string().nullable(),
    questionOptions: QuestionOptionsSchema.nullable(),
    proposerPlayerId: PlayerIdSchema,
    counterPlayerId: PlayerIdSchema.nullable(),
    proposerPick: OptionSchema.nullable(),
    proposerReason: z.string().nullable(),
    counterPick: OptionSchema.nullable(),
    counterReason: z.string().nullable(),
    votes: z.record(z.string(), VoteTargetSchema),
    finalDecision: VoteTargetSchema.nullable(),
    finalCorrect: z.boolean().nullable(),
    scoreboard: z.record(z.string(), z.number().int()),
    updatedAtMs: z.number().int().nonnegative(),
});

export type JoinRoom = z.infer<typeof JoinRoomSchema>;
export type GameStartPayload = z.infer<typeof GameStartPayloadSchema>;
export type ActionError = z.infer<typeof ActionErrorSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type VoteTarget = z.infer<typeof VoteTargetSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type QuestionOptions = z.infer<typeof QuestionOptionsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type RoomState = z.infer<typeof RoomStateSchema>;
