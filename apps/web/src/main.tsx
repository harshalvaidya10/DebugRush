import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { io } from "socket.io-client";


const socketUrl = import.meta.env.VITE_WS_URL ?? "http://localhost:4000";
const socket = io(socketUrl);

(window as any).__socket = socket;

type ActionErrorPayload = {
  code?: unknown;
  message?: unknown;
};

socket.on("connect", () => {
  console.log("connected to server:", socket.id);
});

socket.on("action:error", (error: ActionErrorPayload) => {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR";
  const message =
    typeof error?.message === "string"
      ? error.message
      : "An unexpected action error occurred.";

  console.error(`[action:error] ${code}: ${message}`, error);
});

socket.emit("room:join", {
  roomId: "ABC123",
  playerId: "p1",
  name: "Harshal"
});

socket.on("room:state", (state) => {
  console.log("room state:", state);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
