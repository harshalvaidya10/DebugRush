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

export const OptionSchema = z.enum(["A", "B", "C", "D"]);
export const VoteTargetSchema = z.enum(["proposer", "counter"]);
export const PhaseSchema = z.enum(["propose", "counter", "vote", "final", "reveal"]);
export const QuestionOptionsSchema = z.object({
    A: z.string(),
    B: z.string(),
    C: z.string(),
    D: z.string(),
});

const ReasonSchema = z
    .string()
    .trim()
    .min(1)
    .max(280);

export const ProposerSubmitPayloadSchema = z.object({
    roomId: RoomIdSchema,
    pick: OptionSchema,
    reason: ReasonSchema.optional(),
});

export const CounterSubmitPayloadSchema = z.object({
    roomId: RoomIdSchema,
    pick: OptionSchema,
    reason: ReasonSchema.optional(),
});

export const VoteSubmitPayloadSchema = z.object({
    roomId: RoomIdSchema,
    target: VoteTargetSchema,
});

const VoteChatTextSchema = z
    .string()
    .trim()
    .min(1)
    .max(280);

export const VoteChatSendPayloadSchema = z.object({
    roomId: RoomIdSchema,
    message: VoteChatTextSchema,
});

export const VoteChatMessageSchema = z.object({
    roomId: RoomIdSchema,
    roundIndex: z.number().int().nonnegative(),
    senderPlayerId: PlayerIdSchema,
    senderName: z
        .string()
        .trim()
        .min(1)
        .max(20),
    message: VoteChatTextSchema,
    sentAtMs: z.number().int().nonnegative(),
});

export const FinalDecisionPayloadSchema = z.object({
    roomId: RoomIdSchema,
    decision: VoteTargetSchema,
});

export const RevealSkipPayloadSchema = z.object({
    roomId: RoomIdSchema,
});

export const ActionErrorSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
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

const RoomStateBaseSchema = z.object({
    schemaVersion: z.literal(1),
    roomId: RoomIdSchema,
    hostPlayerId: PlayerIdSchema,
    players: z.array(PlayerSchema).max(5),
    roundIndex: z.number().int().nonnegative(),
    scoreboard: z.record(z.string(), z.number().int()),
    updatedAtMs: z.number().int().nonnegative(),
});

export const LobbyRoomStateSchema = RoomStateBaseSchema.extend({
    status: z.literal("lobby"),
});

export const InRoundRoomStateSchema = RoomStateBaseSchema.extend({
    status: z.enum(["in_round", "game_over"]),
    roundsTotal: z.number().int().positive().catch(1),
    roleOrderPlayerIds: z.array(PlayerIdSchema).max(5).catch([]),
    roleCursor: z.number().int().nonnegative().catch(0),
    phase: PhaseSchema,
    phaseEndsAtMs: z.number().int().nonnegative(),
    questionId: z.string().min(1),
    questionPrompt: z.string().nullable(),
    questionSnippet: z.string().nullable().optional().default(null),
    questionOptions: QuestionOptionsSchema.nullable(),
    correctOption: OptionSchema.nullable().catch(null),
    proposerPlayerId: PlayerIdSchema,
    counterPlayerId: PlayerIdSchema.nullable(),
    proposerAutoPicked: z.boolean().catch(false),
    counterAutoPicked: z.boolean().catch(false),
    proposerPick: OptionSchema.nullable(),
    proposerReason: z.string().nullable(),
    counterPick: OptionSchema.nullable(),
    counterReason: z.string().nullable(),
    systemAlternativePick: OptionSchema.nullable().catch(null),
    votes: z.record(z.string(), VoteTargetSchema),
    finalDecision: VoteTargetSchema.nullable(),
    finalCorrect: z.boolean().nullable(),
    wrongAnswersCount: z.record(z.string(), z.number().int().nonnegative()).catch({}),
    scoreMilestonesMs: z
        .record(z.string(), z.record(z.string(), z.number().int().nonnegative()))
        .catch({}),
});

export const RoomStateSchema = z.discriminatedUnion("status", [
    LobbyRoomStateSchema,
    InRoundRoomStateSchema,
]);

export type JoinRoom = z.infer<typeof JoinRoomSchema>;
export type GameStartPayload = z.infer<typeof GameStartPayloadSchema>;
export type ProposerSubmitPayload = z.infer<typeof ProposerSubmitPayloadSchema>;
export type CounterSubmitPayload = z.infer<typeof CounterSubmitPayloadSchema>;
export type VoteSubmitPayload = z.infer<typeof VoteSubmitPayloadSchema>;
export type VoteChatSendPayload = z.infer<typeof VoteChatSendPayloadSchema>;
export type VoteChatMessage = z.infer<typeof VoteChatMessageSchema>;
export type FinalDecisionPayload = z.infer<typeof FinalDecisionPayloadSchema>;
export type RevealSkipPayload = z.infer<typeof RevealSkipPayloadSchema>;
export type ActionError = z.infer<typeof ActionErrorSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type VoteTarget = z.infer<typeof VoteTargetSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type QuestionOptions = z.infer<typeof QuestionOptionsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type LobbyRoomState = z.infer<typeof LobbyRoomStateSchema>;
export type InRoundRoomState = z.infer<typeof InRoundRoomStateSchema>;
export type RoomState = z.infer<typeof RoomStateSchema>;
