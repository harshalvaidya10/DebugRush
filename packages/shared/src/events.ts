import type { ActionError, GameStartPayload, JoinRoom, RoomState } from "./schemas";

export type AuthIdentityPayload = {
    userId: string;
};

export interface ClientToServerEvents {
    "auth:whoami": () => void;
    "room:join": (payload: JoinRoom) => void;
    "room:leave": () => void;
    "game:start": (payload: GameStartPayload) => void;
}

export interface ServerToClientEvents {
    "auth:identity": (payload: AuthIdentityPayload) => void;
    "room:state": (payload: RoomState) => void;
    "room:left": () => void;
    "action:error": (payload: ActionError) => void;
}
