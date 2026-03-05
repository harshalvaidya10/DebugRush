import { z } from "zod";

/**
 * Player joins a room
 */
export const JoinRoomSchema = z.object({
    roomId: z
        .string()
        .min(6)
        .max(6)
        .regex(/^[A-Z0-9]+$/, "Room ID must be uppercase alphanumeric"),

    playerId: z.string().min(1),

    name: z
        .string()
        .trim()
        .min(1)
        .max(20),
});

export type JoinRoom = z.infer<typeof JoinRoomSchema>;