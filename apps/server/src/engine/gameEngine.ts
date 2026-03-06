import type Redis from "ioredis";
import type { Server } from "socket.io";
import type {
    ActionError,
    ClientToServerEvents,
    InRoundRoomState,
    Option,
    Phase,
    RoomState,
    ServerToClientEvents,
    VoteTarget,
} from "@debugrush/shared";
import { getRoom, mutateRoomWithWatch } from "../repo/roomsRepo";
import { clearRoomTimer, scheduleRoomTimer } from "../timers/roomTimers";

const START_GAME_MAX_RETRIES = 3;
const ADVANCE_PHASE_MAX_RETRIES = 3;
const ROUND_ACTION_MAX_RETRIES = 3;
const MIN_CONNECTED_PLAYERS_TO_START = 3;

const PHASE_DURATION_MS: Record<Phase, number> = {
    propose: 30_000,
    counter: 20_000,
    vote: 20_000,
    final: 12_000,
    reveal: 10_000,
};

const PHASE_ORDER: Phase[] = ["propose", "counter", "vote", "final", "reveal"];
const ALL_OPTIONS: Option[] = ["A", "B", "C", "D"];

const QUESTION_DECK = [
    {
        id: "q-001",
        prompt: "Find the bug in this JavaScript loop:",
        snippet: `function sum(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) {
    total += arr[i];
  }
  return total;
}`,
        options: {
            A: "Change i <= arr.length to i < arr.length",
            B: "Initialize total = 1",
            C: "Use total = arr[i]",
            D: "Start loop from i = 1",
        },
        correct: "A" as const,
    },
//     {
//         id: "q-002",
//         prompt: "Find the bug in this condition:",
//         snippet: `function isAdmin(role) {
//   if (role = "admin") {
//     return true;
//   }
//   return false;
// }`,
//         options: {
//             A: "Use role == 'admin'",
//             B: "Use role === 'admin'",
//             C: "Use role != 'admin'",
//             D: "Remove return true",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-003",
//         prompt: "Why does this return undefined?",
//         snippet: `const nums = [1, 2, 3];
// const squared = nums.map(n => {
//   n * n;
// });`,
//         options: {
//             A: "Replace map with forEach",
//             B: "Add return inside braces",
//             C: "Use n ^ 2",
//             D: "Use filter instead",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-004",
//         prompt: "Fix the async bug:",
//         snippet: `async function loadUser() {
//   const res = fetch("/api/user");
//   const data = await res.json();
//   return data;
// }`,
//         options: {
//             A: "Remove async",
//             B: "Add await before fetch",
//             C: "Use JSON.parse(res)",
//             D: "Replace json() with text()",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-005",
//         prompt: "Why does React not increment twice?",
//         snippet: `const [count, setCount] = useState(0);

// function increment() {
//   setCount(count + 1);
//   setCount(count + 1);
// }`,
//         options: {
//             A: "Use setCount(count + 2)",
//             B: "Use functional state updates",
//             C: "Use count++",
//             D: "Wrap in useMemo",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-006",
//         prompt: "Fix the null safety issue:",
//         snippet: `type User = {
//   profile?: {
//     name: string;
//   };
// };

// function getName(user: User) {
//   return user.profile.name.toUpperCase();
// }`,
//         options: {
//             A: "Use optional chaining",
//             B: "Use any type",
//             C: "Remove profile?",
//             D: "Use toLowerCase()",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-007",
//         prompt: "Find the object mutation bug:",
//         snippet: `const result = [];
// const item = {};

// for (let i = 0; i < 3; i++) {
//   item.index = i;
//   result.push(item);
// }`,
//         options: {
//             A: "Push i only",
//             B: "Create a new object each loop",
//             C: "Use Object.freeze(item)",
//             D: "Use const i",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-008",
//         prompt: "Fix the SQL logic:",
//         snippet: `SELECT * FROM users
// WHERE active = true OR email LIKE '%@company.com';`,
//         options: {
//             A: "Replace OR with AND",
//             B: "Remove WHERE",
//             C: "Use NOT LIKE",
//             D: "Use GROUP BY",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-009",
//         prompt: "Why does this default value fail for empty string?",
//         snippet: `function greet(name) {
//   name = name || "Guest";
//   return "Hello " + name;
// }`,
//         options: {
//             A: "Use ?? instead of ||",
//             B: "Use && instead of ||",
//             C: "Always assign Guest",
//             D: "Use trim() only",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-010",
//         prompt: "Fix the Python default argument bug:",
//         snippet: `def add_item(x, items=[]):
//     items.append(x)
//     return items`,
//         options: {
//             A: "Use items=None and initialize inside",
//             B: "Use tuple instead",
//             C: "Clear list each call",
//             D: "Use global items",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-011",
//         prompt: "Fix the infinite loop bug:",
//         snippet: `let i = 0;
// while (i < 5) {
//   console.log(i);
// }`,
//         options: {
//             A: "Change while to if",
//             B: "Add i++ inside the loop",
//             C: "Start i at 1",
//             D: "Use console.error instead",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-012",
//         prompt: "Fix the array access bug:",
//         snippet: `const arr = [10, 20, 30];
// console.log(arr[3].toString());`,
//         options: {
//             A: "Use arr[2] instead",
//             B: "Use arr.length",
//             C: "Push another value first",
//             D: "Convert arr to object",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-013",
//         prompt: "Why does filter not work here?",
//         snippet: `const nums = [1, 2, 3, 4];
// const even = nums.filter(n => {
//   n % 2 === 0;
// });`,
//         options: {
//             A: "Replace filter with map",
//             B: "Add return inside the callback",
//             C: "Use == instead of ===",
//             D: "Use some instead",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-014",
//         prompt: "Fix the string concatenation bug:",
//         snippet: `const name = "Harshal";
// console.log("Hello, \${name}");`,
//         options: {
//             A: "Use backticks instead of quotes",
//             B: "Use single quotes instead",
//             C: "Use name.toString()",
//             D: "Remove ${}",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-015",
//         prompt: "Fix the promise handling bug:",
//         snippet: `function getData() {
//   fetch("/api/data")
//     .then(res => res.json);
// }`,
//         options: {
//             A: "Use res.json()",
//             B: "Use JSON.parse(res)",
//             C: "Remove then",
//             D: "Use await without async",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-016",
//         prompt: "Fix the JavaScript equality issue:",
//         snippet: `console.log([] == []);`,
//         options: {
//             A: "Use JSON.stringify on both arrays for value comparison",
//             B: "Replace == with ===",
//             C: "Use Object.is([] , []) and expect true",
//             D: "Convert arrays to Set",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-017",
//         prompt: "Find the bug in this reduce call:",
//         snippet: `const nums = [1, 2, 3];
// const sum = nums.reduce((acc, n) => {
//   acc + n;
// }, 0);`,
//         options: {
//             A: "Use map instead of reduce",
//             B: "Return acc + n from callback",
//             C: "Remove initial value 0",
//             D: "Use filter first",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-018",
//         prompt: "Fix the stale reference bug:",
//         snippet: `const user = { name: "A" };
// const copy = user;
// copy.name = "B";`,
//         options: {
//             A: "Use const copy = { ...user }",
//             B: "Use Object.freeze(user)",
//             C: "Use let instead of const",
//             D: "Use JSON.parse(copy)",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-019",
//         prompt: "Fix the optional prop rendering bug in React:",
//         snippet: `function Card({ title }) {
//   return <h1>{title.toUpperCase()}</h1>;
// }`,
//         options: {
//             A: "Assume title always exists",
//             B: "Use title?.toUpperCase() ?? 'UNTITLED'",
//             C: "Convert h1 to div",
//             D: "Use useEffect",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-020",
//         prompt: "Fix the event handler bug in React:",
//         snippet: `<button onClick={handleClick()}>Save</button>`,
//         options: {
//             A: "Use onClick={handleClick}",
//             B: "Use onClick='handleClick()'",
//             C: "Wrap button in form",
//             D: "Use useMemo",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-021",
//         prompt: "Fix the division by zero risk:",
//         snippet: `function avg(sum, count) {
//   return sum / count;
// }`,
//         options: {
//             A: "Check if count === 0 before dividing",
//             B: "Use Math.floor",
//             C: "Convert sum to string",
//             D: "Multiply count by 1",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-022",
//         prompt: "Fix the bad destructuring bug:",
//         snippet: `const user = null;
// const { name } = user;`,
//         options: {
//             A: "Use optional chaining before destructuring or a default object",
//             B: "Rename name to username",
//             C: "Use let user = {} only",
//             D: "Wrap in JSON.stringify",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-023",
//         prompt: "Fix the for...in bug on arrays:",
//         snippet: `const arr = ["a", "b", "c"];
// for (const value in arr) {
//   console.log(value);
// }`,
//         options: {
//             A: "Use for...of to iterate array values",
//             B: "Use while loop",
//             C: "Use Object.keys only",
//             D: "Use map with no callback",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-024",
//         prompt: "Fix the Date month bug:",
//         snippet: `const d = new Date(2026, 12, 1);`,
//         options: {
//             A: "Use month 11 for December",
//             B: "Use month 13 for December",
//             C: "Use string 'December'",
//             D: "Remove the day argument",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-025",
//         prompt: "Fix the missing dependency issue:",
//         snippet: `useEffect(() => {
//   fetchUser(userId);
// }, []);`,
//         options: {
//             A: "Add userId to the dependency array",
//             B: "Remove useEffect",
//             C: "Use useMemo instead",
//             D: "Move fetchUser outside component",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-026",
//         prompt: "Fix the type coercion bug:",
//         snippet: `console.log("5" + 2); // expected 7`,
//         options: {
//             A: "Convert '5' to a number before adding",
//             B: "Use == instead of +",
//             C: "Use String(2)",
//             D: "Wrap in array",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-027",
//         prompt: "Fix the parseInt mapping bug:",
//         snippet: `["1", "2", "3"].map(parseInt);`,
//         options: {
//             A: "Use str => parseInt(str, 10)",
//             B: "Use Number.parseFloat only",
//             C: "Use filter(parseInt)",
//             D: "Use join first",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-028",
//         prompt: "Fix the mutation bug in state:",
//         snippet: `const [user, setUser] = useState({ name: "A" });

// function rename() {
//   user.name = "B";
//   setUser(user);
// }`,
//         options: {
//             A: "Mutate then force re-render",
//             B: "Create a new object in setUser",
//             C: "Use var instead of const",
//             D: "Use useRef instead",
//         },
//         correct: "B" as const,
//     },
//     {
//         id: "q-029",
//         prompt: "Fix the Python string/int bug:",
//         snippet: `age = "21"
// print(age + 1)`,
//         options: {
//             A: "Convert age to int before adding",
//             B: "Convert 1 to string",
//             C: "Use age.append(1)",
//             D: "Use float only",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-030",
//         prompt: "Fix the SQL delete disaster risk:",
//         snippet: `DELETE FROM users;`,
//         options: {
//             A: "Add a WHERE clause if only specific rows should be deleted",
//             B: "Replace DELETE with SELECT",
//             C: "Use INSERT instead",
//             D: "Add ORDER BY only",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-031",
//         prompt: "Fix the fetch error handling issue:",
//         snippet: `const res = await fetch("/api/data");
// const data = await res.json();`,
//         options: {
//             A: "Check res.ok before parsing data",
//             B: "Always assume response is valid",
//             C: "Use res.text only",
//             D: "Remove await",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-032",
//         prompt: "Fix the sort bug:",
//         snippet: `const nums = [10, 2, 30];
// nums.sort();`,
//         options: {
//             A: "Use nums.sort((a, b) => a - b)",
//             B: "Use reverse only",
//             C: "Use map before sort",
//             D: "Use join after sort",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-033",
//         prompt: "Fix the NaN comparison bug:",
//         snippet: `if (value === NaN) {
//   console.log("Not a number");
// }`,
//         options: {
//             A: "Use Number.isNaN(value)",
//             B: "Use value == null",
//             C: "Use value === undefined",
//             D: "Use parseInt first",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-034",
//         prompt: "Fix the missing return in find callback:",
//         snippet: `const found = [1, 2, 3].find(n => {
//   n > 1;
// });`,
//         options: {
//             A: "Add return inside the callback",
//             B: "Use filter instead of find",
//             C: "Use some instead",
//             D: "Start array from 0",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-035",
//         prompt: "Fix the bad object key access:",
//         snippet: `const key = "name";
// const user = { name: "Harshal" };
// console.log(user.key);`,
//         options: {
//             A: "Use user[key]",
//             B: "Use user.name only always",
//             C: "Use user->key",
//             D: "Use Object.values(user)",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-036",
//         prompt: "Fix the JSX list rendering issue:",
//         snippet: `{items.map(item => <li>{item.name}</li>)}`,
//         options: {
//             A: "Add a unique key prop to each li",
//             B: "Wrap li in span",
//             C: "Use forEach instead of map",
//             D: "Convert name to uppercase",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-037",
//         prompt: "Fix the environment variable issue in Vite:",
//         snippet: `const apiUrl = process.env.API_URL;`,
//         options: {
//             A: "Use import.meta.env.VITE_API_URL",
//             B: "Use window.env.API_URL only",
//             C: "Use dotenv in browser directly",
//             D: "Hardcode localhost always",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-038",
//         prompt: "Fix the Node response bug:",
//         snippet: `app.get("/ping", (req, res) => {
//   res.send(200);
// });`,
//         options: {
//             A: "Use res.status(200).send('OK') or res.sendStatus(200)",
//             B: "Use res.json(200) only",
//             C: "Remove req and res",
//             D: "Use return 200",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-039",
//         prompt: "Fix the duplicated timer bug in React:",
//         snippet: `useEffect(() => {
//   setInterval(() => {
//     console.log("tick");
//   }, 1000);
// }, []);`,
//         options: {
//             A: "Return a cleanup function to clearInterval",
//             B: "Use setTimeout only",
//             C: "Move console.log outside",
//             D: "Add more dependencies",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-040",
//         prompt: "Fix the boolean string bug:",
//         snippet: `const isAdmin = "false";
// if (isAdmin) {
//   console.log("Admin");
// }`,
//         options: {
//             A: "Convert the string to a real boolean before checking",
//             B: "Use == false",
//             C: "Leave as is",
//             D: "Wrap in array",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-041",
//         prompt: "Fix the splice/slice confusion:",
//         snippet: `const arr = [1, 2, 3, 4];
// const copy = arr.splice(0, 2);`,
//         options: {
//             A: "Use slice if you want a non-mutating copy",
//             B: "Use pop twice",
//             C: "Use shift only",
//             D: "Use reverse first",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-042",
//         prompt: "Fix the bad JSON parsing bug:",
//         snippet: `const obj = JSON.parse({ name: "A" });`,
//         options: {
//             A: "Pass a JSON string into JSON.parse",
//             B: "Use JSON.parse on arrays only",
//             C: "Replace with JSON.clone",
//             D: "Use Object.parse",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-043",
//         prompt: "Fix the wrong HTTP method bug:",
//         snippet: `fetch("/api/users", {
//   method: "GET",
//   body: JSON.stringify({ name: "A" }),
// });`,
//         options: {
//             A: "Use POST if sending a request body",
//             B: "Use GET with more body fields",
//             C: "Remove headers only",
//             D: "Convert body to number",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-044",
//         prompt: "Fix the Python indentation bug:",
//         snippet: `def greet(name):
// print("Hello", name)`,
//         options: {
//             A: "Indent the print statement inside the function",
//             B: "Remove the colon",
//             C: "Use semicolon instead",
//             D: "Use return only",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-045",
//         prompt: "Fix the Set duplicate expectation bug:",
//         snippet: `const ids = new Set([1, 1, 2, 2]);
// console.log(ids.length);`,
//         options: {
//             A: "Use ids.size instead of ids.length",
//             B: "Convert Set to array first always",
//             C: "Use Map instead",
//             D: "Use ids.count",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-046",
//         prompt: "Fix the class method this bug:",
//         snippet: `class Counter {
//   count = 0;
//   inc() {
//     this.count++;
//   }
// }

// const c = new Counter();
// const fn = c.inc;
// fn();`,
//         options: {
//             A: "Bind the method or use an arrow function",
//             B: "Remove this.count",
//             C: "Use var c",
//             D: "Call fn twice",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-047",
//         prompt: "Fix the Express middleware bug:",
//         snippet: `app.use((req, res, next) => {
//   console.log("request");
// });`,
//         options: {
//             A: "Call next() to continue the request chain",
//             B: "Remove req and res",
//             C: "Use return console.log only",
//             D: "Use app.get instead",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-048",
//         prompt: "Fix the async map bug:",
//         snippet: `const users = ids.map(async id => fetchUser(id));
// console.log(users[0].name);`,
//         options: {
//             A: "Await Promise.all(users) before using resolved values",
//             B: "Remove async from map callback",
//             C: "Use filter instead of map",
//             D: "Convert ids to string first",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-049",
//         prompt: "Fix the localStorage JSON bug:",
//         snippet: `localStorage.setItem("user", { name: "A" });`,
//         options: {
//             A: "Use JSON.stringify before storing the object",
//             B: "Use sessionStorage only",
//             C: "Use parseInt on the object",
//             D: "Store under two keys always",
//         },
//         correct: "A" as const,
//     },
//     {
//         id: "q-050",
//         prompt: "Fix the debounce cleanup bug:",
//         snippet: `useEffect(() => {
//   const id = setTimeout(() => {
//     save();
//   }, 500);
// }, [value]);`,
//         options: {
//             A: "Return a cleanup function to clearTimeout(id)",
//             B: "Replace setTimeout with setInterval",
//             C: "Remove dependency array",
//             D: "Call save() directly before timeout",
//         },
//         correct: "A" as const,
//     },
];
type EngineSuccess = {
    ok: true;
    state: RoomState;
};

type EngineFailure = {
    ok: false;
    error: ActionError;
};

type EngineResult = EngineSuccess | EngineFailure;

type VoteResolution =
    | {
          kind: "winner";
          decision: VoteTarget;
      }
    | {
          kind: "tie";
      };

export type StartGameInput = {
    roomId: string;
    requesterPlayerId: string;
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
};

type RoundActionInputBase = {
    roomId: string;
    requesterPlayerId: string;
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
};

export type SubmitProposerPickInput = RoundActionInputBase & {
    pick: Option;
    reason?: string;
};

export type SubmitCounterPickInput = RoundActionInputBase & {
    pick: Option;
    reason?: string;
};

export type SubmitVoteInput = RoundActionInputBase & {
    target: VoteTarget;
};

export type SubmitFinalDecisionInput = RoundActionInputBase & {
    decision: VoteTarget;
};

export type SubmitRevealSkipInput = RoundActionInputBase;

export type StartGameResult = EngineResult;

export type AdvancePhaseInput = {
    roomId: string;
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    expectedPhase?: Phase;
    expectedPhaseEndsAtMs?: number;
    force?: boolean;
    requesterPlayerId?: string;
};

export type AdvancePhaseResult = EngineResult;
export type SubmitRoundActionResult = EngineResult;

export type RecoverRoomTimersInput = {
    redis: Redis;
    io: Server<ClientToServerEvents, ServerToClientEvents>;
};

function buildActionError(code: string, message: string): EngineFailure {
    return {
        ok: false,
        error: { code, message },
    };
}

function buildScoreboardForPlayers(current: RoomState): Record<string, number> {
    const next: Record<string, number> = {};

    for (const player of current.players) {
        const existing = current.scoreboard[player.id];
        next[player.id] = Number.isInteger(existing) ? existing : 0;
    }

    return next;
}

function buildFreshScoreboardForPlayers(current: RoomState): Record<string, number> {
    const next: Record<string, number> = {};

    for (const player of current.players) {
        next[player.id] = 0;
    }

    return next;
}

function normalizeOptionalReason(reason?: string): string | null {
    if (typeof reason !== "string") {
        return null;
    }

    const trimmed = reason.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getQuestionById(questionId: string) {
    return QUESTION_DECK.find((question) => question.id === questionId) ?? null;
}

function getCorrectOptionForQuestion(questionId: string): Option | null {
    return getQuestionById(questionId)?.correct ?? null;
}

function pickSystemAlternativeForDuplicatePick(state: InRoundRoomState): Option | null {
    if (!state.proposerPick) {
        return null;
    }

    const question = getQuestionById(state.questionId);
    if (!question) {
        return null;
    }

    const sharedPick = state.proposerPick;
    const remainingOptions = ALL_OPTIONS.filter((option) => option !== sharedPick);
    if (remainingOptions.length === 0) {
        return null;
    }

    // Guarantee exactly one correct option between the shared choice and system alternative.
    if (sharedPick === question.correct) {
        const incorrectOptions = remainingOptions.filter((option) => option !== question.correct);
        if (incorrectOptions.length === 0) {
            return null;
        }

        return pickRandomItem(incorrectOptions);
    }

    return question.correct;
}

function applySystemAlternativeIfNeeded(state: InRoundRoomState, now: number): InRoundRoomState {
    if (state.phase !== "vote") {
        return state;
    }

    if (state.systemAlternativePick) {
        return state;
    }

    if (!state.proposerPick || !state.counterPick) {
        return state;
    }

    if (state.proposerPick !== state.counterPick) {
        return state;
    }

    const systemAlternative = pickSystemAlternativeForDuplicatePick(state);
    if (!systemAlternative || systemAlternative === state.proposerPick) {
        return state;
    }

    return {
        ...state,
        systemAlternativePick: systemAlternative,
        updatedAtMs: now,
    };
}

function shouldEndGameImmediatelyForDifferentWrongPicks(state: InRoundRoomState): boolean {
    if (!state.proposerPick || !state.counterPick) {
        return false;
    }

    if (state.proposerPick === state.counterPick) {
        return false;
    }

    const correctOption = getCorrectOptionForQuestion(state.questionId);
    if (!correctOption) {
        return false;
    }

    return state.proposerPick !== correctOption && state.counterPick !== correctOption;
}

function pickQuestion(excludedQuestionId?: string) {
    if (QUESTION_DECK.length === 0) {
        return null;
    }

    if (QUESTION_DECK.length === 1) {
        return QUESTION_DECK[0];
    }

    const candidateDeck = QUESTION_DECK.filter((question) => question.id !== excludedQuestionId);
    const sourceDeck = candidateDeck.length > 0 ? candidateDeck : QUESTION_DECK;
    const randomIndex = Math.floor(Math.random() * sourceDeck.length);
    return sourceDeck[randomIndex];
}

function pickRandomItem<T>(items: T[]): T {
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex];
}

function getConnectedPlayers(state: RoomState) {
    return state.players.filter((player) => player.connected);
}

function buildRoundRobinOrder(state: RoomState): string[] {
    return getConnectedPlayers(state)
        .slice()
        .sort((a, b) => a.joinedAtMs - b.joinedAtMs || a.id.localeCompare(b.id))
        .map((player) => player.id);
}

function getRoundRobinRoles(roleOrderPlayerIds: string[], roleCursor: number) {
    if (roleOrderPlayerIds.length < 2) {
        return null;
    }

    const normalizedCursor = ((roleCursor % roleOrderPlayerIds.length) + roleOrderPlayerIds.length) % roleOrderPlayerIds.length;
    const proposerPlayerId = roleOrderPlayerIds[normalizedCursor];
    const counterPlayerId = roleOrderPlayerIds[(normalizedCursor + 1) % roleOrderPlayerIds.length] ?? null;

    return {
        proposerPlayerId,
        counterPlayerId,
        roleCursor: normalizedCursor,
    };
}

function getRoundPlayerIdByTarget(state: InRoundRoomState, target: VoteTarget): string | null {
    if (target === "proposer") {
        return state.proposerPlayerId;
    }

    if (state.systemAlternativePick) {
        return null;
    }

    return state.counterPlayerId;
}

function getRoundPickByTarget(state: InRoundRoomState, target: VoteTarget): Option | null {
    if (target === "proposer") {
        return state.proposerPick;
    }

    if (state.systemAlternativePick) {
        return state.systemAlternativePick;
    }

    return state.counterPick;
}

function resolveVoteOutcome(state: InRoundRoomState): VoteResolution {
    const hasProposerPick = Boolean(state.proposerPick);
    const hasCounterPick = Boolean(getRoundPickByTarget(state, "counter"));

    if (!hasCounterPick) {
        return {
            kind: "winner",
            decision: "proposer",
        };
    }

    if (!hasProposerPick) {
        return {
            kind: "winner",
            decision: "counter",
        };
    }

    let proposerVotes = 0;
    let counterVotes = 0;
    const eligibleVoterPlayerIds = getEligibleVoterPlayerIds(state);
    for (const voterPlayerId of eligibleVoterPlayerIds) {
        const target = state.votes[voterPlayerId];
        if (!target) {
            continue;
        }

        if (target === "counter") {
            counterVotes += 1;
        } else {
            proposerVotes += 1;
        }
    }

    // In duplicate-pick rounds (proposerPick === counterPick), both role picks back
    // the shared option. Count them as baseline support so one voter cannot override 2 role picks.
    const isDuplicatePickRound =
        Boolean(state.systemAlternativePick) &&
        Boolean(state.proposerPick) &&
        Boolean(state.counterPick) &&
        state.proposerPick === state.counterPick;
    if (isDuplicatePickRound) {
        proposerVotes += 2;
    }

    if (proposerVotes === counterVotes) {
        return {
            kind: "tie",
        };
    }

    return {
        kind: "winner",
        decision: counterVotes > proposerVotes ? "counter" : "proposer",
    };
}

function resolveFinalDecision(state: InRoundRoomState): VoteTarget {
    if (state.finalDecision) {
        return state.finalDecision;
    }

    const voteOutcome = resolveVoteOutcome(state);
    if (voteOutcome.kind === "winner") {
        return voteOutcome.decision;
    }

    // Tie fallback should not drive scoring/game-over logic.
    // We keep this deterministic only for defensive code paths.
    return "proposer";
}

function computeFinalCorrect(state: InRoundRoomState, finalDecision: VoteTarget): boolean {
    const question = getQuestionById(state.questionId);
    if (!question) {
        return false;
    }

    const selectedPick = getRoundPickByTarget(state, finalDecision);
    if (!selectedPick) {
        return false;
    }

    return selectedPick === question.correct;
}

function applyRoundScoring(
    state: InRoundRoomState,
    finalDecision: VoteTarget,
    finalCorrect: boolean
): Record<string, number> {
    const nextScoreboard = buildScoreboardForPlayers(state);
    const selectedPlayerId = getRoundPlayerIdByTarget(state, finalDecision);

    if (finalCorrect) {
        if (selectedPlayerId) {
            nextScoreboard[selectedPlayerId] = (nextScoreboard[selectedPlayerId] ?? 0) + 3;
        }
        for (const [voterPlayerId, target] of Object.entries(state.votes)) {
            if (target === finalDecision && nextScoreboard[voterPlayerId] !== undefined) {
                nextScoreboard[voterPlayerId] += 1;
            }
        }

        return nextScoreboard;
    }

    const oppositeTarget: VoteTarget = finalDecision === "proposer" ? "counter" : "proposer";
    const oppositePlayerId = getRoundPlayerIdByTarget(state, oppositeTarget);
    const oppositePick = getRoundPickByTarget(state, oppositeTarget);
    const question = getQuestionById(state.questionId);

    if (oppositePlayerId && question && oppositePick === question.correct) {
        nextScoreboard[oppositePlayerId] = (nextScoreboard[oppositePlayerId] ?? 0) + 2;
    }

    return nextScoreboard;
}

function ensureActiveRoundPlayer(state: InRoundRoomState, requesterPlayerId: string): EngineFailure | null {
    const requester = state.players.find((player) => player.id === requesterPlayerId);

    if (!requester) {
        return buildActionError("PLAYER_NOT_IN_ROOM", "Player is not in this room.");
    }

    if (!requester.connected) {
        return buildActionError("PLAYER_OFFLINE", "Reconnect before performing this action.");
    }

    return null;
}

function getEligibleVoterPlayerIds(state: InRoundRoomState): string[] {
    return state.players
        .filter((player) => player.connected)
        .filter((player) => player.id !== state.proposerPlayerId)
        .filter((player) => player.id !== state.counterPlayerId)
        .map((player) => player.id);
}

function haveAllEligibleVotersSubmitted(state: InRoundRoomState): boolean {
    const eligibleVoters = getEligibleVoterPlayerIds(state);
    if (eligibleVoters.length === 0) {
        return true;
    }

    return eligibleVoters.every((playerId) => state.votes[playerId] === "proposer" || state.votes[playerId] === "counter");
}

function shouldAdvanceImmediatelyAfterAction(state: InRoundRoomState): boolean {
    if (state.phase === "propose") {
        return Boolean(state.proposerPick);
    }

    if (state.phase === "counter") {
        if (!state.counterPlayerId) {
            return true;
        }

        return Boolean(state.counterPick);
    }

    if (state.phase === "vote") {
        return haveAllEligibleVotersSubmitted(state);
    }

    if (state.phase === "final") {
        return Boolean(state.finalDecision);
    }

    return false;
}

async function maybeAdvanceImmediatelyAfterAction(
    state: RoomState,
    redis: Redis,
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    if (state.status !== "in_round") {
        return;
    }

    if (!shouldAdvanceImmediatelyAfterAction(state)) {
        return;
    }

    const advanceResult = await advancePhase({
        roomId: state.roomId,
        redis,
        io,
        expectedPhase: state.phase,
        expectedPhaseEndsAtMs: state.phaseEndsAtMs,
        force: true,
    });

    if (
        "error" in advanceResult &&
        advanceResult.error.code !== "STALE_PHASE" &&
        advanceResult.error.code !== "STALE_TIMER"
    ) {
        console.warn("failed to advance phase immediately after action", {
            roomId: state.roomId,
            phase: state.phase,
            errorCode: advanceResult.error.code,
            errorMessage: advanceResult.error.message,
        });
    }
}

function getNextPhase(current: Phase): Phase | null {
    const currentIndex = PHASE_ORDER.indexOf(current);
    if (currentIndex === -1) {
        return null;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= PHASE_ORDER.length) {
        return null;
    }

    return PHASE_ORDER[nextIndex];
}

function schedulePhaseTimerForState(
    state: RoomState,
    redis: Redis,
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    if (state.status !== "in_round") {
        clearRoomTimer(state.roomId);
        return;
    }

    const timerDelayMs = scheduleRoomTimer(state.roomId, state.phaseEndsAtMs, () => {
        void handleRoomPhaseTimeout({
            roomId: state.roomId,
            redis,
            io,
            expectedPhase: state.phase,
            expectedPhaseEndsAtMs: state.phaseEndsAtMs,
        });
    });

    console.log("phase timer scheduled", {
        roomId: state.roomId,
        phase: state.phase,
        phaseEndsAtMs: state.phaseEndsAtMs,
        timerDelayMs,
    });
}

function publishRoomState(
    state: RoomState,
    redis: Redis,
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    io.to(state.roomId).emit("room:state", state);
    schedulePhaseTimerForState(state, redis, io);
}

async function handleRoomPhaseTimeout(input: AdvancePhaseInput) {
    try {
        const latestState = await getRoom(input.redis, input.roomId);

        if (!latestState) {
            clearRoomTimer(input.roomId);
            return;
        }

        if (latestState.status !== "in_round") {
            clearRoomTimer(input.roomId);
            return;
        }

        if (
            input.expectedPhase &&
            (latestState.phase !== input.expectedPhase ||
                latestState.phaseEndsAtMs !== input.expectedPhaseEndsAtMs)
        ) {
            schedulePhaseTimerForState(latestState, input.redis, input.io);
            return;
        }

        if (Date.now() < latestState.phaseEndsAtMs) {
            schedulePhaseTimerForState(latestState, input.redis, input.io);
            return;
        }

        await advancePhase({
            roomId: input.roomId,
            redis: input.redis,
            io: input.io,
            expectedPhase: latestState.phase,
            expectedPhaseEndsAtMs: latestState.phaseEndsAtMs,
        });
    } catch (error) {
        console.error("phase timeout handler failed", {
            roomId: input.roomId,
            error,
        });
    }
}

async function listPersistedRoomIds(redis: Redis): Promise<string[]> {
    const roomIds: string[] = [];
    let cursor = "0";

    do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "room:*", "COUNT", 200);
        cursor = nextCursor;

        for (const key of keys) {
            if (!key.startsWith("room:")) {
                continue;
            }

            const roomId = key.slice("room:".length);
            if (roomId.length > 0) {
                roomIds.push(roomId);
            }
        }
    } while (cursor !== "0");

    return roomIds;
}

export async function recoverInRoundRoomTimers(input: RecoverRoomTimersInput): Promise<void> {
    const roomIds = await listPersistedRoomIds(input.redis);
    let recoveredCount = 0;

    for (const roomId of roomIds) {
        try {
            const roomState = await getRoom(input.redis, roomId);
            if (!roomState || roomState.status !== "in_round") {
                continue;
            }

            schedulePhaseTimerForState(roomState, input.redis, input.io);
            recoveredCount += 1;
        } catch (error) {
            console.error("failed to recover room timer", {
                roomId,
                error,
            });
        }
    }

    console.log("room timer recovery complete", {
        roomsScanned: roomIds.length,
        timersRecovered: recoveredCount,
    });
}

function emitMutatedRoomState(
    state: RoomState,
    redis: Redis,
    io: Server<ClientToServerEvents, ServerToClientEvents>
) {
    if (state.status === "in_round") {
        publishRoomState(state, redis, io);
        return;
    }

    io.to(state.roomId).emit("room:state", state);
    clearRoomTimer(state.roomId);
}

export async function startGame(input: StartGameInput): Promise<StartGameResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.hostPlayerId !== input.requesterPlayerId) {
                return buildActionError("FORBIDDEN", "Only host can start the game.");
            }

            if (current.status !== "lobby" && current.status !== "game_over") {
                return buildActionError(
                    "INVALID_STATE",
                    "Game can only be started from lobby or after game over."
                );
            }

            const hostPlayer = current.players.find((player) => player.id === current.hostPlayerId);
            if (!hostPlayer || !hostPlayer.connected) {
                return buildActionError("HOST_OFFLINE", "Host must be connected to start the game.");
            }

            const connectedPlayers = current.players
                .filter((player) => player.connected)
                .sort((a, b) => a.joinedAtMs - b.joinedAtMs);

            if (connectedPlayers.length < MIN_CONNECTED_PLAYERS_TO_START) {
                return buildActionError(
                    "MIN_PLAYERS",
                    "Not enough players to start. At least 3 connected players are required."
                );
            }

            const now = Date.now();
            const firstQuestion = pickQuestion();
            if (!firstQuestion) {
                return buildActionError("QUESTION_DECK_EMPTY", "No questions available in deck.");
            }

            const roleOrderPlayerIds = buildRoundRobinOrder(current);
            const roles = getRoundRobinRoles(roleOrderPlayerIds, 0);
            if (!roles) {
                return buildActionError("MIN_PLAYERS", "No connected players found in the room.");
            }

            const nextState: RoomState = {
                ...current,
                status: "in_round",
                roundIndex: 1,
                roundsTotal: roleOrderPlayerIds.length,
                roleOrderPlayerIds,
                roleCursor: roles.roleCursor,
                phase: "propose",
                phaseEndsAtMs: now + PHASE_DURATION_MS.propose,
                questionId: firstQuestion.id,
                questionPrompt: firstQuestion.prompt,
                questionSnippet: firstQuestion.snippet,
                questionOptions: firstQuestion.options,
                correctOption: null,
                proposerPlayerId: roles.proposerPlayerId,
                counterPlayerId: roles.counterPlayerId,
                proposerPick: null,
                proposerReason: null,
                counterPick: null,
                counterReason: null,
                systemAlternativePick: null,
                votes: {},
                finalDecision: null,
                finalCorrect: null,
                scoreboard: buildFreshScoreboardForPlayers(current),
                updatedAtMs: now,
            };

            return {
                ok: true,
                state: nextState,
            };
        },
        START_GAME_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        return {
            ok: false,
            error: {
                code: mutationResult.error.code,
                message: mutationResult.error.message,
            },
        };
    }

    const startedState = mutationResult.state;
    if (startedState.status !== "in_round") {
        return buildActionError(
            "INVALID_STATE",
            "Room did not transition to in_round during startGame."
        );
    }

    publishRoomState(startedState, input.redis, input.io);

    console.log("game:start completed", {
        roomId: input.roomId,
        requesterPlayerId: input.requesterPlayerId,
        questionId: startedState.questionId,
        phase: startedState.phase,
        phaseEndsAtMs: startedState.phaseEndsAtMs,
    });

    return {
        ok: true,
        state: startedState,
    };
}

export async function submitProposerPick(
    input: SubmitProposerPickInput
): Promise<SubmitRoundActionResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.status !== "in_round") {
                return buildActionError("INVALID_STATE", "Room is not currently in an active round.");
            }

            const playerCheck = ensureActiveRoundPlayer(current, input.requesterPlayerId);
            if (playerCheck) {
                return playerCheck;
            }

            if (current.phase !== "propose") {
                return buildActionError("INVALID_PHASE", "Proposer can only submit during propose phase.");
            }

            if (current.proposerPlayerId !== input.requesterPlayerId) {
                return buildActionError("FORBIDDEN", "Only the proposer can submit the proposer answer.");
            }

            if (current.proposerPick) {
                return buildActionError("ALREADY_SUBMITTED", "Proposer answer is already locked.");
            }

            return {
                ok: true,
                state: {
                    ...current,
                    proposerPick: input.pick,
                    proposerReason: normalizeOptionalReason(input.reason),
                    updatedAtMs: Date.now(),
                },
            };
        },
        ROUND_ACTION_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        return {
            ok: false,
            error: mutationResult.error,
        };
    }

    emitMutatedRoomState(mutationResult.state, input.redis, input.io);
    await maybeAdvanceImmediatelyAfterAction(mutationResult.state, input.redis, input.io);
    console.log("proposer submission saved", {
        roomId: input.roomId,
        requesterPlayerId: input.requesterPlayerId,
        pick: input.pick,
    });

    return {
        ok: true,
        state: mutationResult.state,
    };
}

export async function submitCounterPick(
    input: SubmitCounterPickInput
): Promise<SubmitRoundActionResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.status !== "in_round") {
                return buildActionError("INVALID_STATE", "Room is not currently in an active round.");
            }

            const playerCheck = ensureActiveRoundPlayer(current, input.requesterPlayerId);
            if (playerCheck) {
                return playerCheck;
            }

            if (current.phase !== "counter") {
                return buildActionError("INVALID_PHASE", "Counter can only submit during counter phase.");
            }

            if (!current.counterPlayerId) {
                return buildActionError("NO_COUNTER", "No counter role is assigned for this round.");
            }

            if (current.counterPlayerId !== input.requesterPlayerId) {
                return buildActionError("FORBIDDEN", "Only the counter can submit the counter answer.");
            }

            if (current.counterPick) {
                return buildActionError("ALREADY_SUBMITTED", "Counter answer is already locked.");
            }

            return {
                ok: true,
                state: {
                    ...current,
                    counterPick: input.pick,
                    counterReason: normalizeOptionalReason(input.reason),
                    updatedAtMs: Date.now(),
                },
            };
        },
        ROUND_ACTION_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        return {
            ok: false,
            error: mutationResult.error,
        };
    }

    emitMutatedRoomState(mutationResult.state, input.redis, input.io);
    await maybeAdvanceImmediatelyAfterAction(mutationResult.state, input.redis, input.io);
    console.log("counter submission saved", {
        roomId: input.roomId,
        requesterPlayerId: input.requesterPlayerId,
        pick: input.pick,
    });

    return {
        ok: true,
        state: mutationResult.state,
    };
}

export async function submitVote(input: SubmitVoteInput): Promise<SubmitRoundActionResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.status !== "in_round") {
                return buildActionError("INVALID_STATE", "Room is not currently in an active round.");
            }

            const normalizedCurrent =
                current.phase === "vote" ? applySystemAlternativeIfNeeded(current, Date.now()) : current;

            const playerCheck = ensureActiveRoundPlayer(normalizedCurrent, input.requesterPlayerId);
            if (playerCheck) {
                return playerCheck;
            }

            if (normalizedCurrent.phase !== "vote") {
                return buildActionError("INVALID_PHASE", "Voting is only allowed during vote phase.");
            }

            if (input.requesterPlayerId === normalizedCurrent.proposerPlayerId) {
                return buildActionError("FORBIDDEN", "Proposer cannot vote in this phase.");
            }

            if (
                normalizedCurrent.counterPlayerId &&
                input.requesterPlayerId === normalizedCurrent.counterPlayerId
            ) {
                return buildActionError("FORBIDDEN", "Counter cannot vote in this phase.");
            }

            if (normalizedCurrent.votes[input.requesterPlayerId]) {
                return buildActionError(
                    "ALREADY_SUBMITTED",
                    "Vote already submitted for this round."
                );
            }

            if (input.target === "counter") {
                const hasCounterVoteTarget = Boolean(
                    normalizedCurrent.systemAlternativePick ||
                        (normalizedCurrent.counterPlayerId && normalizedCurrent.counterPick)
                );
                if (!hasCounterVoteTarget) {
                    return buildActionError(
                        "INVALID_TARGET",
                        "Counter vote is unavailable until counter answer exists."
                    );
                }
            }

            if (input.target === "proposer" && !normalizedCurrent.proposerPick) {
                return buildActionError(
                    "INVALID_TARGET",
                    "Proposer vote is unavailable until proposer answer exists."
                );
            }

            return {
                ok: true,
                state: {
                    ...normalizedCurrent,
                    votes: {
                        ...normalizedCurrent.votes,
                        [input.requesterPlayerId]: input.target,
                    },
                    updatedAtMs: Date.now(),
                },
            };
        },
        ROUND_ACTION_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        return {
            ok: false,
            error: mutationResult.error,
        };
    }

    emitMutatedRoomState(mutationResult.state, input.redis, input.io);
    await maybeAdvanceImmediatelyAfterAction(mutationResult.state, input.redis, input.io);
    console.log("vote saved", {
        roomId: input.roomId,
        requesterPlayerId: input.requesterPlayerId,
        target: input.target,
    });

    return {
        ok: true,
        state: mutationResult.state,
    };
}

export async function submitFinalDecision(
    _input: SubmitFinalDecisionInput
): Promise<SubmitRoundActionResult> {
    return buildActionError(
        "DISABLED_ACTION",
        "Final decision is automatic now and uses majority voting."
    );
}

export async function submitRevealSkip(
    input: SubmitRevealSkipInput
): Promise<SubmitRoundActionResult> {
    const currentState = await getRoom(input.redis, input.roomId);
    if (!currentState) {
        return buildActionError("ROOM_NOT_FOUND", "Room not found.");
    }

    if (currentState.status !== "in_round") {
        return buildActionError("INVALID_STATE", "Reveal skip is only available during active rounds.");
    }

    if (currentState.phase !== "reveal") {
        return buildActionError("INVALID_PHASE", "Reveal skip is only available in reveal phase.");
    }

    const advanceResult = await advancePhase({
        roomId: input.roomId,
        redis: input.redis,
        io: input.io,
        expectedPhase: "reveal",
        expectedPhaseEndsAtMs: currentState.phaseEndsAtMs,
        force: true,
        requesterPlayerId: input.requesterPlayerId,
    });

    if ("error" in advanceResult) {
        if (advanceResult.error.code === "STALE_PHASE") {
            const latestState = await getRoom(input.redis, input.roomId);
            if (latestState && (latestState.status !== "in_round" || latestState.phase !== "reveal")) {
                return {
                    ok: true,
                    state: latestState,
                };
            }
        }

        return advanceResult;
    }

    return advanceResult;
}

export async function advancePhase(input: AdvancePhaseInput): Promise<AdvancePhaseResult> {
    const mutationResult = await mutateRoomWithWatch(
        input.redis,
        input.roomId,
        (current) => {
            if (current.status !== "in_round") {
                return buildActionError("INVALID_STATE", "Room is not currently in a round.");
            }

            if (input.expectedPhase && current.phase !== input.expectedPhase) {
                return buildActionError("STALE_PHASE", "Phase already advanced by another process.");
            }

            if (
                typeof input.expectedPhaseEndsAtMs === "number" &&
                current.phaseEndsAtMs !== input.expectedPhaseEndsAtMs
            ) {
                return buildActionError("STALE_TIMER", "Phase end timestamp changed before timeout.");
            }

            if (input.requesterPlayerId) {
                const playerCheck = ensureActiveRoundPlayer(current, input.requesterPlayerId);
                if (playerCheck) {
                    return playerCheck;
                }
            }

            const now = Date.now();
            if (!input.force && now < current.phaseEndsAtMs) {
                return buildActionError("PHASE_NOT_EXPIRED", "Current phase is still active.");
            }

            let workingState: InRoundRoomState = current;

            if (current.phase === "propose" && !current.proposerPick) {
                workingState = {
                    ...workingState,
                    proposerPick: pickRandomItem(ALL_OPTIONS),
                    proposerReason: current.proposerReason ?? "Auto-picked due to proposer timeout.",
                };
            }

            if (workingState.phase === "counter" && workingState.counterPlayerId && !workingState.counterPick) {
                workingState = {
                    ...workingState,
                    counterPick: pickRandomItem(ALL_OPTIONS),
                    counterReason: workingState.counterReason ?? "Auto-picked due to counter timeout.",
                };
            }

            if (workingState.phase === "vote") {
                const correctOption = getCorrectOptionForQuestion(workingState.questionId);
                const voteOutcome = resolveVoteOutcome(workingState);
                if (voteOutcome.kind === "tie") {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            phase: "reveal",
                            phaseEndsAtMs: now + PHASE_DURATION_MS.reveal,
                            finalDecision: null,
                            finalCorrect: null,
                            correctOption,
                            updatedAtMs: now,
                        },
                    };
                }

                const resolvedDecision = voteOutcome.decision;
                const finalCorrect = computeFinalCorrect(workingState, resolvedDecision);
                const nextScoreboard = applyRoundScoring(workingState, resolvedDecision, finalCorrect);

                if (!finalCorrect) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phase: "reveal",
                            phaseEndsAtMs: 0,
                            finalDecision: resolvedDecision,
                            finalCorrect,
                            correctOption,
                            scoreboard: nextScoreboard,
                            updatedAtMs: now,
                        },
                    };
                }

                return {
                    ok: true,
                    state: {
                        ...workingState,
                        phase: "reveal",
                        phaseEndsAtMs: now + PHASE_DURATION_MS.reveal,
                        finalDecision: resolvedDecision,
                        finalCorrect,
                        correctOption,
                        scoreboard: nextScoreboard,
                        updatedAtMs: now,
                    },
                };
            }

            if (workingState.phase === "final") {
                const resolvedDecision = resolveFinalDecision(workingState);
                const finalCorrect = computeFinalCorrect(workingState, resolvedDecision);
                const nextScoreboard = applyRoundScoring(workingState, resolvedDecision, finalCorrect);
                const correctOption = getCorrectOptionForQuestion(workingState.questionId);

                if (!finalCorrect) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phase: "reveal",
                            phaseEndsAtMs: 0,
                            finalDecision: resolvedDecision,
                            finalCorrect,
                            correctOption,
                            scoreboard: nextScoreboard,
                            updatedAtMs: now,
                        },
                    };
                }

                return {
                    ok: true,
                    state: {
                        ...workingState,
                        phase: "reveal",
                        phaseEndsAtMs: now + PHASE_DURATION_MS.reveal,
                        finalDecision: resolvedDecision,
                        finalCorrect,
                        correctOption,
                        scoreboard: nextScoreboard,
                        updatedAtMs: now,
                    },
                };
            }

            if (workingState.phase === "reveal") {
                const roundsTotal =
                    Number.isInteger(workingState.roundsTotal) && workingState.roundsTotal > 0
                        ? workingState.roundsTotal
                        : workingState.roleOrderPlayerIds.length;

                if (workingState.roundIndex >= roundsTotal) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phaseEndsAtMs: 0,
                            updatedAtMs: now,
                        },
                    };
                }

                const connectedPlayers = getConnectedPlayers(workingState);
                if (connectedPlayers.length < MIN_CONNECTED_PLAYERS_TO_START) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phase: "reveal",
                            phaseEndsAtMs: 0,
                            updatedAtMs: now,
                        },
                    };
                }

                const connectedPlayerIds = new Set(connectedPlayers.map((player) => player.id));
                const roleOrderStillConnected = workingState.roleOrderPlayerIds.filter((playerId) =>
                    connectedPlayerIds.has(playerId)
                );
                if (
                    roleOrderStillConnected.length !== workingState.roleOrderPlayerIds.length ||
                    roleOrderStillConnected.length !== roundsTotal
                ) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phase: "reveal",
                            phaseEndsAtMs: 0,
                            updatedAtMs: now,
                        },
                    };
                }

                const nextQuestion = pickQuestion(workingState.questionId);
                if (!nextQuestion) {
                    return buildActionError("QUESTION_DECK_EMPTY", "No questions available in deck.");
                }

                const nextRoles = getRoundRobinRoles(
                    roleOrderStillConnected,
                    workingState.roleCursor + 1
                );
                if (!nextRoles) {
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            status: "game_over",
                            phase: "reveal",
                            phaseEndsAtMs: 0,
                            updatedAtMs: now,
                        },
                    };
                }

                return {
                    ok: true,
                    state: {
                        ...workingState,
                        status: "in_round",
                        roundIndex: workingState.roundIndex + 1,
                        roundsTotal,
                        roleOrderPlayerIds: roleOrderStillConnected,
                        roleCursor: nextRoles.roleCursor,
                        phase: "propose",
                        phaseEndsAtMs: now + PHASE_DURATION_MS.propose,
                        questionId: nextQuestion.id,
                        questionPrompt: nextQuestion.prompt,
                        questionSnippet: nextQuestion.snippet,
                        questionOptions: nextQuestion.options,
                        correctOption: null,
                        proposerPlayerId: nextRoles.proposerPlayerId,
                        counterPlayerId: nextRoles.counterPlayerId,
                        proposerPick: null,
                        proposerReason: null,
                        counterPick: null,
                        counterReason: null,
                        systemAlternativePick: null,
                        votes: {},
                        finalDecision: null,
                        finalCorrect: null,
                        scoreboard: buildScoreboardForPlayers(workingState),
                        updatedAtMs: now,
                    },
                };
            }

            if (workingState.phase === "counter" && shouldEndGameImmediatelyForDifferentWrongPicks(workingState)) {
                return {
                    ok: true,
                    state: {
                        ...workingState,
                        status: "game_over",
                        phase: "reveal",
                        phaseEndsAtMs: 0,
                        finalDecision: null,
                        finalCorrect: false,
                        correctOption: getCorrectOptionForQuestion(workingState.questionId),
                        systemAlternativePick: null,
                        updatedAtMs: now,
                    },
                };
            }

            const nextPhase = getNextPhase(workingState.phase);
            if (!nextPhase) {
                return {
                    ok: true,
                    state: {
                        ...workingState,
                        status: "game_over",
                        phaseEndsAtMs: 0,
                        updatedAtMs: now,
                    },
                };
            }

            return {
                ok: true,
                state: applySystemAlternativeIfNeeded(
                    {
                    ...workingState,
                    phase: nextPhase,
                    phaseEndsAtMs: now + PHASE_DURATION_MS[nextPhase],
                    updatedAtMs: now,
                    },
                    now
                ),
            };
        },
        ADVANCE_PHASE_MAX_RETRIES
    );

    if ("error" in mutationResult) {
        if (mutationResult.error.code === "STALE_PHASE" || mutationResult.error.code === "STALE_TIMER") {
            const latestState = await getRoom(input.redis, input.roomId);
            if (latestState && latestState.status === "in_round") {
                schedulePhaseTimerForState(latestState, input.redis, input.io);
            }
        }

        return {
            ok: false,
            error: {
                code: mutationResult.error.code,
                message: mutationResult.error.message,
            },
        };
    }

    const nextState = mutationResult.state;
    if (nextState.status === "lobby") {
        return buildActionError(
            "INVALID_STATE",
            "advancePhase produced lobby state, which is invalid."
        );
    }

    if (nextState.status === "in_round") {
        publishRoomState(nextState, input.redis, input.io);
        await maybeAdvanceImmediatelyAfterAction(nextState, input.redis, input.io);
    } else {
        input.io.to(input.roomId).emit("room:state", nextState);
        clearRoomTimer(input.roomId);
    }

    console.log("phase advanced", {
        roomId: input.roomId,
        status: nextState.status,
        phase: nextState.phase,
        phaseEndsAtMs: nextState.phaseEndsAtMs,
    });

    return {
        ok: true,
        state: nextState,
    };
}
