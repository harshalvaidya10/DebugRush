import { useEffect, useState } from "react";
import type { ActionError, AuthIdentityPayload, RoomState } from "@debugrush/shared";
import WelcomeScreen from "./pages/WelcomeScreen";
import LobbyScreen from "./pages/LobbyScreen";
import RoundScreen from "./pages/RoundScreen";
import GameOverScreen from "./pages/GameOverScreen";
import socket from "./socket";

type SavedSession = {
  roomId: string;
  name: string;
};

const ROOM_SESSION_KEY = "debugrush_last_session";
const roomSessionStorage = import.meta.env.DEV ? sessionStorage : localStorage;

function isSavedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { roomId?: unknown; name?: unknown };
  return (
    typeof candidate.roomId === "string" &&
    candidate.roomId.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0
  );
}

function createRoomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

/**
 * Render the main application UI: show a waiting screen until a room state is received, then render the lobby with room metadata and player list.
 *
 * Subscribes to the global socket at `window.__socket` for `"room:state"` updates, updates internal room state when events arrive, logs a warning if the socket is not present, and unsubscribes on unmount.
 *
 * @returns The React element for the app — either a waiting/debug screen or the lobby view populated from the current `RoomState`.
 */
export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => {
    try {
      const raw = roomSessionStorage.getItem(ROOM_SESSION_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isSavedSession(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  const clearLocalSessionAndReturnToWelcome = () => {
    try {
      roomSessionStorage.removeItem(ROOM_SESSION_KEY);
    } catch (error) {
      console.warn("Failed to clear room session:", error);
    }

    setSavedSession(null);
    setAutoJoinAttempted(false);
    setRoom(null);
    setJoinError(null);
    setLoading(false);
  };

  useEffect(() => {
    const requestIdentity = () => {
      socket.emit("auth:whoami");
    };

    const onIdentity = (payload: AuthIdentityPayload) => {
      if (typeof payload?.userId === "string" && payload.userId.length > 0) {
        setMyUserId(payload.userId);
        setJoinError((current) =>
          current === "Waiting for identity..." ? null : current
        );
      }
    };

    const onRoomState = (state: RoomState) => {
      setRoom(state);
      setLoading(false);
      setJoinError(null);
    };

    const onRoomLeft = () => {
      clearLocalSessionAndReturnToWelcome();
    };

    const onActionError = (err: ActionError) => {
      setLoading(false);
      setJoinError(err?.message ?? "Join failed");
      console.log("join error from server:", err);

    };

    socket.on("connect", requestIdentity);
    socket.on("auth:identity", onIdentity)
    socket.on("room:state", onRoomState);
    socket.on("room:left", onRoomLeft);
    socket.on("action:error", onActionError);
    requestIdentity();
    return () => {
      socket.off("connect", requestIdentity);
      socket.off("auth:identity", onIdentity);
      socket.off("room:state", onRoomState);
      socket.off("room:left", onRoomLeft);
      socket.off("action:error", onActionError);
    };
  }, []);

  const emitJoin = (roomId: string, name: string) => {
    const userId = myUserId;
    if (!userId) {
      socket.emit("auth:whoami");
      setJoinError("Waiting for identity...");
      return; // important
    }

    const normalizedRoomId = roomId.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!normalizedRoomId || !trimmedName) {
      setJoinError("Name and room ID are required.");
      return;
    }

    setLoading(true);
    setJoinError(null);
    setAutoJoinAttempted(true);
    const nextSession = { roomId: normalizedRoomId, name: trimmedName };
    try {
      roomSessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(nextSession));
    } catch (error) {
      console.warn("Failed to persist room session:", error);
    }
    setSavedSession(nextSession);

    socket.emit("room:join", {
      roomId: normalizedRoomId,
      playerId: userId,
      name: trimmedName,
    });
  };

  const handleCreateRoom = (name: string) => {
    emitJoin(createRoomId(), name);
  };

  const handleJoinRoom = (roomId: string, name: string) => {
    emitJoin(roomId, name);
  };

  const handleLeaveRoom = () => {
    if (socket && room) {
      socket.emit("room:leave");
    }
  };

  const handleStartGame = () => {
    if (!room) {
      return;
    }

    setJoinError(null);
    socket.emit("game:start", { roomId: room.roomId });
  };

  useEffect(() => {
    if (!myUserId || room || !savedSession || autoJoinAttempted) return;
    setAutoJoinAttempted(true);
    emitJoin(savedSession.roomId, savedSession.name);
  }, [myUserId, room, savedSession, autoJoinAttempted]);

  const isIdentityReady = Boolean(myUserId);
  const welcomeError = joinError ?? (isIdentityReady ? null : "Waiting for identity...");
  const isWelcomeLoading = loading || !isIdentityReady;


  if (!room) {
    return (
      <WelcomeScreen
        loading={isWelcomeLoading}
        error={welcomeError}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  }

  if (room.status === "in_round") {
    return (
      <RoundScreen
        room={room}
        meId={myUserId ?? undefined}
        onLeave={handleLeaveRoom}
        error={joinError}
      />
    );
  }

  if (room.status === "game_over") {
    return (
      <GameOverScreen
        room={room}
        meId={myUserId ?? undefined}
        onLeave={handleLeaveRoom}
        error={joinError}
      />
    );
  }

  return (
    <LobbyScreen
      room={room}
      meId={myUserId ?? undefined}
      onLeave={handleLeaveRoom}
      onStartGame={handleStartGame}
      error={joinError}
    />
  );
}
