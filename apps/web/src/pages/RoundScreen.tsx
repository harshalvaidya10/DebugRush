import { useEffect, useMemo, useRef, useState } from "react";
import type { InRoundRoomState, Option, VoteChatMessage, VoteTarget } from "@debugrush/shared";

type RoundScreenProps = {
  room: InRoundRoomState;
  meId?: string;
  onLeave?: () => void;
  onSubmitProposerPick?: (pick: Option, reason?: string) => void;
  onSubmitCounterPick?: (pick: Option, reason?: string) => void;
  onSubmitVote?: (target: VoteTarget) => void;
  onSendVoteChatMessage?: (message: string) => void;
  voteChatMessages?: VoteChatMessage[];
  onSkipReveal?: () => void;
  error?: string | null;
};

type ToastState = {
  id: number;
  message: string;
};

type PendingVoteChatDraftState = {
  text: string;
  preSendMatchCount: number;
};

type VoteChatAccentStyle = {
  bubbleClass: string;
  nameClass: string;
};

const VOTE_CHAT_ACCENT_STYLES: VoteChatAccentStyle[] = [
  { bubbleClass: "vote-chat-accent-emerald", nameClass: "vote-chat-name-emerald" },
  { bubbleClass: "vote-chat-accent-amber", nameClass: "vote-chat-name-amber" },
  { bubbleClass: "vote-chat-accent-rose", nameClass: "vote-chat-name-rose" },
  { bubbleClass: "vote-chat-accent-violet", nameClass: "vote-chat-name-violet" },
  { bubbleClass: "vote-chat-accent-sky", nameClass: "vote-chat-name-sky" },
  { bubbleClass: "vote-chat-accent-lime", nameClass: "vote-chat-name-lime" },
];

function formatCountdown(msRemaining: number) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function getPlayerName(room: InRoundRoomState, playerId: string | null) {
  if (!playerId) {
    return "Unassigned";
  }

  return room.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getRoleLabel(isMeProposer: boolean, isMeCounter: boolean, isMeVoter: boolean) {
  if (isMeProposer) {
    return "Proposer";
  }

  if (isMeCounter) {
    return "Counter";
  }

  if (isMeVoter) {
    return "Voter";
  }

  return "Spectator";
}

function formatChoice(room: InRoundRoomState, pick: Option | null) {
  if (!pick) {
    return null;
  }

  const optionText = room.questionOptions?.[pick] ?? "";
  return `${pick}. ${optionText}`.trim();
}

function hashPlayerIdForAccent(playerId: string) {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getVoteChatAccentForPlayer(playerId: string) {
  const accentIndex = hashPlayerIdForAccent(playerId) % VOTE_CHAT_ACCENT_STYLES.length;
  return VOTE_CHAT_ACCENT_STYLES[accentIndex];
}

function countMatchingVoteChatMessages(
  messages: VoteChatMessage[],
  senderPlayerId: string,
  text: string
) {
  return messages.reduce((count, message) => {
    if (message.senderPlayerId === senderPlayerId && message.message === text) {
      return count + 1;
    }

    return count;
  }, 0);
}

export default function RoundScreen({
  room,
  meId,
  onLeave,
  onSubmitProposerPick,
  onSubmitCounterPick,
  onSubmitVote,
  onSendVoteChatMessage,
  voteChatMessages = [],
  onSkipReveal,
  error = null,
}: RoundScreenProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [proposerReason, setProposerReason] = useState("");
  const [counterReason, setCounterReason] = useState("");
  const [proposerSelection, setProposerSelection] = useState<Option | null>(null);
  const [counterSelection, setCounterSelection] = useState<Option | null>(null);
  const [voteSelectionOption, setVoteSelectionOption] = useState<Option | null>(null);
  const [voteChatDraft, setVoteChatDraft] = useState("");
  const [pendingVoteChatDraft, setPendingVoteChatDraft] = useState<PendingVoteChatDraftState | null>(null);

  const lastAnnouncementKeyRef = useRef("");
  const voteChatScrollRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const proposerName = getPlayerName(room, room.proposerPlayerId);
  const counterName = getPlayerName(room, room.counterPlayerId);
  const isMeProposer = Boolean(meId && meId === room.proposerPlayerId);
  const isMeCounter = Boolean(meId && room.counterPlayerId && meId === room.counterPlayerId);
  const isMeVoter = Boolean(meId && !isMeProposer && !isMeCounter);
  const roleLabel = getRoleLabel(isMeProposer, isMeCounter, isMeVoter);

  const proposerPlayer = room.players.find((player) => player.id === room.proposerPlayerId);
  const counterPlayer = room.players.find((player) => player.id === room.counterPlayerId);
  const voters = useMemo(
    () =>
      room.players.filter(
        (player) => player.id !== room.proposerPlayerId && player.id !== room.counterPlayerId
      ),
    [room.players, room.proposerPlayerId, room.counterPlayerId]
  );

  const countdown = useMemo(
    () => formatCountdown(room.phaseEndsAtMs - nowMs),
    [room.phaseEndsAtMs, nowMs]
  );

  const optionEntries = useMemo(
    () => (room.questionOptions ? (Object.entries(room.questionOptions) as [Option, string][]) : []),
    [room.questionOptions]
  );
  const voteOptionKeys = useMemo(() => {
    if (room.phase !== "vote") {
      return null;
    }

    const keys = new Set<Option>();
    if (room.proposerPick) {
      keys.add(room.proposerPick);
    }
    if (room.systemAlternativePick) {
      keys.add(room.systemAlternativePick);
    } else if (room.counterPick) {
      keys.add(room.counterPick);
    }

    return keys;
  }, [room.phase, room.proposerPick, room.counterPick, room.systemAlternativePick]);
  const visibleOptionEntries = useMemo(() => {
    if (room.phase !== "vote" || !voteOptionKeys) {
      return optionEntries;
    }

    return optionEntries.filter(([optionKey]) => voteOptionKeys.has(optionKey));
  }, [room.phase, voteOptionKeys, optionEntries]);

  const canEnterProposerReason = room.phase === "propose" && isMeProposer && !room.proposerPick;
  const canEnterCounterReason = room.phase === "counter" && isMeCounter && !room.counterPick;
  const canUseVoterChat = room.phase === "vote" && isMeVoter;
  const myVote = meId ? room.votes[meId] : undefined;
  const isSystemAlternativeRound = room.phase === "vote" && Boolean(room.systemAlternativePick);
  const isTieReveal = room.phase === "reveal" && room.finalDecision === null && room.finalCorrect === null;

  const correctOptionText = room.correctOption ? room.questionOptions?.[room.correctOption] ?? "" : "";
  const winningPick = isTieReveal
    ? null
    : room.finalDecision === "counter"
      ? room.systemAlternativePick ?? room.counterPick
      : room.proposerPick;
  const winningPickText = winningPick ? room.questionOptions?.[winningPick] ?? "" : "";
  const winningName = isTieReveal
    ? "No majority"
    : room.finalDecision === "counter"
      ? room.systemAlternativePick
        ? "System Alternative"
        : counterName
      : proposerName;

  const pushToast = (message: string) => {
    setToast({
      id: Date.now() + Math.floor(Math.random() * 10_000),
      message,
    });
  };

  const submitVoteChatMessage = () => {
    const normalized = voteChatDraft.trim();
    if (!normalized || !canUseVoterChat || !onSendVoteChatMessage || !meId) {
      return;
    }

    const preSendMatchCount = countMatchingVoteChatMessages(
      voteChatMessages,
      meId,
      normalized
    );

    onSendVoteChatMessage(normalized);
    setPendingVoteChatDraft({
      text: normalized,
      preSendMatchCount,
    });
  };

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutHandle = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2500);

    return () => {
      clearTimeout(timeoutHandle);
    };
  }, [toast]);

  useEffect(() => {
    const announcementKey = [
      room.roundIndex,
      room.phase,
      room.proposerPlayerId,
      room.counterPlayerId ?? "none",
      room.finalDecision ?? "none",
      room.finalCorrect == null ? "pending" : room.finalCorrect ? "true" : "false",
    ].join(":");

    if (announcementKey === lastAnnouncementKeyRef.current) {
      return;
    }

    lastAnnouncementKeyRef.current = announcementKey;

    if (room.phase === "propose") {
      pushToast(`Round ${room.roundIndex}: ${proposerName} is proposer.`);
      return;
    }

    if (room.phase === "counter") {
      pushToast(`${counterName} is now counter.`);
      return;
    }

    if (room.phase === "vote") {
      pushToast("Voters: pick a side and submit.");
      return;
    }

    if (room.phase === "reveal") {
      if (isTieReveal) {
        pushToast("No majority vote. Moving to next round.");
      } else {
        pushToast(room.finalCorrect ? "Correct! Moving to next round." : "Wrong answer. Game over.");
      }
    }
  }, [
    room.roundIndex,
    room.phase,
    room.proposerPlayerId,
    room.counterPlayerId,
    room.finalDecision,
    room.finalCorrect,
    isTieReveal,
    proposerName,
    counterName,
  ]);

  useEffect(() => {
    if (room.phase !== "propose" || !isMeProposer || room.proposerPick) {
      setProposerReason("");
      setProposerSelection(null);
      return;
    }

    setProposerReason(room.proposerReason ?? "");
  }, [room.phase, room.proposerPick, room.proposerReason, isMeProposer]);

  useEffect(() => {
    if (room.phase !== "counter" || !isMeCounter || room.counterPick) {
      setCounterReason("");
      setCounterSelection(null);
      return;
    }

    setCounterReason(room.counterReason ?? "");
  }, [room.phase, room.counterPick, room.counterReason, isMeCounter]);

  useEffect(() => {
    if (room.phase !== "vote") {
      setVoteSelectionOption(null);
    }
  }, [room.phase]);

  useEffect(() => {
    if (!canUseVoterChat) {
      return;
    }

    const list = voteChatScrollRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [canUseVoterChat, voteChatMessages]);

  useEffect(() => {
    if (!pendingVoteChatDraft || !meId) {
      return;
    }

    const currentMatchCount = countMatchingVoteChatMessages(
      voteChatMessages,
      meId,
      pendingVoteChatDraft.text
    );

    if (currentMatchCount <= pendingVoteChatDraft.preSendMatchCount) {
      return;
    }

    setPendingVoteChatDraft(null);
    setVoteChatDraft((currentDraft) =>
      currentDraft.trim() === pendingVoteChatDraft.text ? "" : currentDraft
    );
  }, [pendingVoteChatDraft, voteChatMessages, meId]);

  return (
    <div className="screen-round min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      {toast ? (
        <div className="toast-pop cyber-toast fixed right-4 top-4 z-50 max-w-sm rounded-lg border border-cyan-300 bg-cyan-100 px-4 py-3 text-sm font-medium text-cyan-900 shadow-xl sm:right-6 sm:top-6">
          {toast.message}
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-4">
        <header className="app-card p-5 sm:p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="app-pill inline-flex px-3 py-1 text-xs font-semibold text-cyan-800">
              Live Match
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Round {room.roundIndex}</h1>
            <p className="mt-1 text-sm text-slate-700">
              Room: <span className="font-code font-semibold text-sky-800">{room.roomId}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-sky-700">Phase</p>
              <p className="font-semibold text-sky-900 uppercase">{room.phase}</p>
            </div>

            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-violet-700">Your Role</p>
              <p className="font-semibold text-violet-900">{roleLabel}</p>
            </div>

            <div className="cyber-timer rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-amber-700">Time Left</p>
              <p className="font-code text-lg font-semibold text-amber-900">{countdown}</p>
            </div>

            {onLeave ? (
              <button
                onClick={onLeave}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Leave
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <section className="round-board-grid">
          <aside className="role-column app-card p-4 sm:p-5">
            <div className={`role-card proposer ${room.phase === "propose" ? "phase-active" : ""}`}>
              <div className="player-row">
                <div className="avatar-shell avatar-proposer">{getInitials(proposerName)}</div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Proposer</p>
                  <p className="font-semibold text-slate-900">{proposerName}</p>
                  {proposerPlayer && !proposerPlayer.connected ? (
                    <p className="text-xs text-rose-600">Offline</p>
                  ) : null}
                </div>
              </div>

              <div className={`thought-bubble ${room.proposerPick ? "bubble-pop" : "placeholder"}`}>
                {room.proposerPick
                  ? `Option: ${formatChoice(room, room.proposerPick)}`
                  : room.phase === "propose"
                    ? "Thinking..."
                    : "Waiting for proposer pick"}
              </div>

              <div
                className={`thought-bubble secondary ${
                  room.proposerReason ? "bubble-pop" : "placeholder"
                }`}
              >
                {room.proposerReason ?? "No reason submitted"}
              </div>

              {canEnterProposerReason ? (
                <textarea
                  value={proposerReason}
                  onChange={(event) => setProposerReason(event.target.value)}
                  maxLength={280}
                  placeholder="Your reason (optional)"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              ) : null}
            </div>

            <div className={`role-card counter mt-3 ${room.phase === "counter" ? "phase-active" : ""}`}>
              <div className="player-row">
                <div className="avatar-shell avatar-counter">{getInitials(counterName)}</div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Counter</p>
                  <p className="font-semibold text-slate-900">{counterName}</p>
                  {counterPlayer && !counterPlayer.connected ? (
                    <p className="text-xs text-rose-600">Offline</p>
                  ) : null}
                </div>
              </div>

              <div className={`thought-bubble ${room.counterPick ? "bubble-pop" : "placeholder"}`}>
                {room.counterPick
                  ? `Option: ${formatChoice(room, room.counterPick)}`
                  : room.phase === "counter"
                    ? "Thinking..."
                    : "Waiting for counter pick"}
              </div>

              <div
                className={`thought-bubble secondary ${
                  room.counterReason ? "bubble-pop" : "placeholder"
                }`}
              >
                {room.counterReason ?? "No reason submitted"}
              </div>

              {canEnterCounterReason ? (
                <textarea
                  value={counterReason}
                  onChange={(event) => setCounterReason(event.target.value)}
                  maxLength={280}
                  placeholder="Your reason (optional)"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
                />
              ) : null}
            </div>
          </aside>

          <main className="app-card p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-slate-900">
              {room.questionPrompt ?? `Question: ${room.questionId}`}
            </h2>

            {room.questionSnippet ? (
              <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100">
                <code className="font-code">{room.questionSnippet}</code>
              </pre>
            ) : null}

            {visibleOptionEntries.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {visibleOptionEntries.map(([optionKey, optionText]) => {
                  const isProposerOption = room.proposerPick === optionKey;
                  const isSystemOption = room.systemAlternativePick === optionKey;
                  const isCounterOption = !room.systemAlternativePick && room.counterPick === optionKey;
                  const isMySubmittedVoteForThisOption =
                    room.phase === "vote" &&
                    Boolean(myVote) &&
                    (myVote === "proposer"
                      ? isProposerOption
                      : isSystemOption || (!room.systemAlternativePick && isCounterOption));

                  const availableTargets: VoteTarget[] = [];
                  if (room.phase === "vote") {
                    if (isProposerOption) {
                      availableTargets.push("proposer");
                    }
                    if (isSystemOption || (!room.systemAlternativePick && isCounterOption)) {
                      availableTargets.push("counter");
                    }
                  } else {
                    if (isProposerOption) {
                      availableTargets.push("proposer");
                    }
                    if (isCounterOption) {
                      availableTargets.push("counter");
                    }
                  }

                  let selected = false;
                  let cardClickable = false;
                  let disabledReason = "";
                  let accentClass = "border-slate-700/70 bg-slate-950/70 hover:border-cyan-400/70";
                  let onCardClick: (() => void) | undefined;

                  if (room.phase === "propose") {
                    if (!isMeProposer) {
                      disabledReason = "Waiting for proposer action.";
                    } else if (room.proposerPick) {
                      selected = isProposerOption;
                      disabledReason = "Proposer choice is locked.";
                    } else {
                      cardClickable = true;
                      selected = proposerSelection === optionKey;
                      accentClass = "border-amber-400/70 bg-amber-950/30 hover:border-amber-300";
                      onCardClick = () => setProposerSelection(optionKey);
                    }
                  } else if (room.phase === "counter") {
                    if (!isMeCounter) {
                      disabledReason = "Waiting for counter action.";
                    } else if (room.counterPick) {
                      selected = isCounterOption;
                      disabledReason = "Counter choice is locked.";
                    } else {
                      cardClickable = true;
                      selected = counterSelection === optionKey;
                      accentClass = "border-rose-400/70 bg-rose-950/30 hover:border-rose-300";
                      onCardClick = () => setCounterSelection(optionKey);
                    }
                  } else if (room.phase === "vote") {
                    if (!isMeVoter) {
                      disabledReason = "Only voters can submit in vote phase.";
                    } else if (myVote) {
                      selected = isMySubmittedVoteForThisOption;
                      disabledReason = "Vote already submitted for this round.";
                    } else if (availableTargets.length === 0) {
                      disabledReason = "This option is not available to vote right now.";
                    } else {
                      cardClickable = true;
                      selected = voteSelectionOption === optionKey;
                      accentClass = "border-sky-400/70 bg-sky-950/30 hover:border-sky-300";
                      onCardClick = () => {
                        setVoteSelectionOption(optionKey);
                      };
                    }
                  } else {
                    disabledReason = "Waiting for next phase.";
                  }

                  return (
                    <li
                      key={optionKey}
                      onClick={cardClickable ? onCardClick : undefined}
                      onKeyDown={
                        cardClickable && onCardClick
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onCardClick();
                              }
                            }
                          : undefined
                      }
                      tabIndex={cardClickable ? 0 : -1}
                      role="button"
                      aria-disabled={!cardClickable}
                      className={`option-card rounded-xl border p-3 transition ${accentClass} ${
                        cardClickable ? "cursor-pointer" : "opacity-90"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-slate-800">
                          <span className="font-code mr-2">{optionKey}.</span>
                          {optionText}
                        </p>

                        <div className="flex flex-wrap gap-1">
                          {isProposerOption ? (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                              proposer
                            </span>
                          ) : null}
                          {isCounterOption ? (
                            <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-800">
                              counter
                            </span>
                          ) : null}
                          {isSystemOption ? (
                            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">
                              system
                            </span>
                          ) : null}
                          {selected ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              selected
                            </span>
                          ) : null}
                          {isMySubmittedVoteForThisOption ? (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                              your vote
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {!cardClickable && disabledReason ? (
                        <p className="mt-2 text-xs text-slate-600">{disabledReason}</p>
                      ) : null}

                      {room.phase === "propose" && selected && !room.proposerPick ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!proposerSelection) {
                              return;
                            }

                            onSubmitProposerPick?.(proposerSelection, proposerReason.trim() || undefined);
                            pushToast(`Submitted proposer option ${proposerSelection}.`);
                          }}
                          className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                        >
                          Submit as proposer
                        </button>
                      ) : null}

                      {room.phase === "counter" && selected && !room.counterPick ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!counterSelection) {
                              return;
                            }

                            onSubmitCounterPick?.(counterSelection, counterReason.trim() || undefined);
                            pushToast(`Submitted counter option ${counterSelection}.`);
                          }}
                          className="mt-3 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500"
                        >
                          Submit as counter
                        </button>
                      ) : null}

                      {room.phase === "vote" && selected && isMeVoter && !myVote ? (
                        <div className="mt-3 space-y-2">
                          {availableTargets.length > 1 ? (
                            <div className="flex flex-wrap gap-2">
                              {availableTargets.map((target) => {
                                const buttonClass =
                                  target === "proposer"
                                    ? "bg-sky-600 hover:bg-sky-500"
                                    : "bg-fuchsia-600 hover:bg-fuchsia-500";

                                return (
                                <button
                                  key={target}
                                  type="button"
                                  onClick={() => {
                                    onSubmitVote?.(target);
                                    pushToast(`Submitted vote for ${target}.`);
                                  }}
                                  className={`rounded-full px-3 py-1.5 text-xs font-semibold text-white ${buttonClass}`}
                                >
                                  Submit vote for {target}
                                </button>
                                );
                              })}
                            </div>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => {
                              const onlyTarget = availableTargets[0];
                              if (!onlyTarget) return;
                              onSubmitVote?.(onlyTarget);
                              pushToast(`Submitted vote for ${onlyTarget}.`);
                            }}
                            disabled={availableTargets.length !== 1}
                            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {availableTargets.length === 1
                              ? `Submit vote for ${availableTargets[0]}`
                              : "Pick a side above"}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                {room.phase === "vote"
                  ? "Waiting for vote options to lock in. Try again in a moment."
                  : "Options appear when question data is loaded."}
              </p>
            )}

            {room.phase === "vote" ? (
              <p className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
                {isSystemAlternativeRound
                  ? "Proposer and counter selected the same option, so the system added one alternative. Vote between these two options."
                  : "Vote between the proposer and counter options shown above."}
              </p>
            ) : null}

            {canUseVoterChat ? (
              <section className="mt-4 rounded-xl border border-cyan-300/55 bg-slate-900/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-cyan-200">
                    Voter Chat
                  </h3>
                  <p className="text-[11px] text-cyan-300/90">Only voters can read and send in vote phase</p>
                </div>

                <ul
                  ref={voteChatScrollRef}
                  className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-700/80 bg-slate-950/60 p-2"
                >
                  {voteChatMessages.length > 0 ? (
                    voteChatMessages.map((chatMessage, index) => {
                      const isMine = meId === chatMessage.senderPlayerId;
                      const accentStyle = getVoteChatAccentForPlayer(chatMessage.senderPlayerId);

                      return (
                        <li
                          key={`${chatMessage.senderPlayerId}:${chatMessage.sentAtMs}:${index}`}
                          className={`vote-chat-bubble ${
                            isMine
                              ? "vote-chat-bubble-mine"
                              : `vote-chat-bubble-other ${accentStyle.bubbleClass}`
                          }`}
                        >
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                              isMine ? "text-cyan-100" : accentStyle.nameClass
                            }`}
                          >
                            {isMine ? "You" : chatMessage.senderName}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{chatMessage.message}</p>
                        </li>
                      );
                    })
                  ) : (
                    <li className="rounded-lg border border-dashed border-slate-700 px-2.5 py-2 text-xs text-slate-400">
                      No chat yet. Coordinate with other voters before locking your vote.
                    </li>
                  )}
                </ul>

                <div className="mt-3 flex gap-2">
                  <input
                    value={voteChatDraft}
                    onChange={(event) => setVoteChatDraft(event.target.value)}
                    onKeyDown={(event) => {
                      const isComposing =
                        ("isComposing" in event &&
                          Boolean((event as { isComposing?: boolean }).isComposing)) ||
                        event.nativeEvent.isComposing;
                      if (isComposing) {
                        return;
                      }

                      if (event.key !== "Enter" || event.shiftKey) {
                        return;
                      }

                      event.preventDefault();
                      submitVoteChatMessage();
                    }}
                    maxLength={280}
                    placeholder="Share your vote strategy..."
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <button
                    type="button"
                    onClick={submitVoteChatMessage}
                    disabled={voteChatDraft.trim().length === 0}
                    className="rounded-lg border border-cyan-300 bg-cyan-600/90 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </section>
            ) : null}

            <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              <p className="text-sm text-slate-700">
                Your vote: <span className="font-semibold">{myVote ?? "Not submitted"}</span>
              </p>
              <p className="text-sm text-slate-700">
                Final decision:{" "}
                <span className="font-semibold">
                  {isTieReveal ? "No majority (tie)" : room.finalDecision ?? "Pending"}
                </span>
              </p>
            </div>
          </main>

          <aside className={`voter-column app-card p-4 sm:p-5 ${room.phase === "vote" ? "phase-active-voters" : ""}`}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Voters</h3>
            <p className="mt-1 text-xs text-slate-500">Right side team votes for proposer or counter</p>

            <ul className="mt-3 space-y-3">
              {voters.length > 0 ? (
                voters.map((player) => {
                  const vote = room.votes[player.id];
                  const voteLabel = vote ? `votes ${vote.toUpperCase()}` : "has not voted yet";

                  return (
                    <li key={player.id} className="voter-card rounded-xl border border-slate-200 bg-white p-3">
                      <div className="player-row">
                        <div className="avatar-shell avatar-voter">{getInitials(player.name)}</div>
                        <div>
                          <p className="font-semibold text-slate-900">{player.name}</p>
                          <p className="text-xs text-slate-500">{player.connected ? "Online" : "Offline"}</p>
                        </div>
                      </div>

                      <div
                        className={`thought-bubble vote ${vote ? "bubble-pop" : "placeholder"} mt-2 ${
                          vote === "proposer"
                            ? "vote-proposer"
                            : vote === "counter"
                              ? "vote-counter"
                              : ""
                        }`}
                      >
                        {voteLabel}
                      </div>
                    </li>
                  );
                })
              ) : (
                <li className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  No voters available. Add more players for richer rounds.
                </li>
              )}
            </ul>
          </aside>
        </section>
      </div>

      {room.phase === "reveal" ? (
        <div className="reveal-overlay">
          <div className="reveal-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Round Reveal</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              {isTieReveal
                ? "No majority vote. Next round starts now."
                : room.finalCorrect
                  ? "Congratulations! You move on."
                  : "Game over"}
            </h2>

            {isTieReveal ? (
              <p className="mt-2 text-sm text-slate-700">
                Votes were tied, so there is no majority winner for this round.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-700">
                Majority selected <span className="font-semibold">{winningName}</span>
                {winningPick ? ` with ${winningPick}. ${winningPickText}` : "."}
              </p>
            )}

            {room.questionSnippet ? (
              <pre className="mt-3 max-h-44 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
                <code className="font-code">{room.questionSnippet}</code>
              </pre>
            ) : null}

            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Correct option: <span className="font-semibold">{room.correctOption ? `${room.correctOption}. ${correctOptionText}` : "Unknown"}</span>
            </p>

            <p className="mt-2 text-xs text-slate-500">
              {isTieReveal
                ? "Round tied. Starting next round automatically."
                : room.finalCorrect
                  ? "Next round will begin automatically."
                  : "Your room is now finished. Use Leave to return."}
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onSkipReveal?.();
                  pushToast("Skipping reveal...");
                }}
                className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
