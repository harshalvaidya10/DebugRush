import type {
    ActionError,
    CounterSubmitPayload,
    FinalDecisionPayload,
    GameStartPayload,
    JoinRoom,
    ProposerSubmitPayload,
    RevealSkipPayload,
    RoomState,
    VoteChatMessage,
    VoteChatSendPayload,
    VoteSubmitPayload,
} from "./schemas";

export type AuthIdentityPayload = {
    userId: string;
};

export interface ClientToServerEvents {
    "auth:whoami": () => void;
    "room:join": (payload: JoinRoom) => void;
    "room:leave": () => void;
    "game:start": (payload: GameStartPayload) => void;
    "round:proposer:submit": (payload: ProposerSubmitPayload) => void;
    "round:counter:submit": (payload: CounterSubmitPayload) => void;
    "round:vote:submit": (payload: VoteSubmitPayload) => void;
    "round:vote:chat:send": (payload: VoteChatSendPayload) => void;
    "round:final:submit": (payload: FinalDecisionPayload) => void;
    "round:reveal:skip": (payload: RevealSkipPayload) => void;
}

export interface ServerToClientEvents {
    "auth:identity": (payload: AuthIdentityPayload) => void;
    "room:state": (payload: RoomState) => void;
    "room:left": () => void;
    "round:vote:chat:message": (payload: VoteChatMessage) => void;
    "action:error": (payload: ActionError) => void;
}
