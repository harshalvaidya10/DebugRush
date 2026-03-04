import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { io } from "socket.io-client";


const socket = io("http://localhost:4000");

(window as any).__socket = socket;

socket.on("connect", () => {
  console.log("connected to server:", socket.id);
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
