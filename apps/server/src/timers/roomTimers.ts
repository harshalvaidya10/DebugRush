const roomTimers = new Map<string, NodeJS.Timeout>();

export function clearRoomTimer(roomId: string) {
    const existingTimer = roomTimers.get(roomId);
    if (!existingTimer) {
        return;
    }

    clearTimeout(existingTimer);
    roomTimers.delete(roomId);
}

export function scheduleRoomTimer(
    roomId: string,
    phaseEndsAtMs: number,
    onExpired: () => void
) {
    clearRoomTimer(roomId);

    const delayMs = Math.max(0, phaseEndsAtMs - Date.now());
    const timeoutHandle = setTimeout(() => {
        roomTimers.delete(roomId);
        onExpired();
    }, delayMs);

    roomTimers.set(roomId, timeoutHandle);

    return delayMs;
}
