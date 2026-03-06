import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@debugrush/shared";

const CLIENT_ID_KEY = "debugrush_client_id";

const idStorage = import.meta.env.DEV ? sessionStorage : localStorage;


function getOrCreateClientId(): string {
  const existing = idStorage.getItem(CLIENT_ID_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const created = crypto.randomUUID();
  idStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

const configuredSocketUrl = import.meta.env.VITE_WS_URL;
const hasConfiguredSocketUrl =
  typeof configuredSocketUrl === "string" && configuredSocketUrl.trim().length > 0;

if (!hasConfiguredSocketUrl && !import.meta.env.DEV) {
  throw new Error("Missing VITE_WS_URL for non-development build.");
}

const socketUrl =
  hasConfiguredSocketUrl
    ? configuredSocketUrl
    : "http://localhost:4000";

const clientId = getOrCreateClientId();

const socket = io(socketUrl, {
  auth: {
    clientId,
  },
}) as Socket<ServerToClientEvents, ClientToServerEvents>;

(window as any).__socket = socket;

socket.on("connect", () => {
  console.log("connected to server:", socket.id, "clientId:", clientId);
});

socket.on("connect_error", (error) => {
  console.error("socket connection error:", error.message);
});

export default socket;
