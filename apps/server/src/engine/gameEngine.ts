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
    propose: 40_000,
    counter: 30_000,
    vote: 50_000,
    final: 12_000,
    reveal: 10_000,
};

const PHASE_ORDER: Phase[] = ["propose", "counter", "vote", "final", "reveal"];
const ALL_OPTIONS: Option[] = ["A", "B", "C", "D"];

const QUESTION_DECK = [
    {
        id: "q-001",
        prompt: "Find the bug in this loop boundary:",
        snippet: `sum = 0
for i from 0 to length(arr):
sum = sum + arr[i]
return sum`,
        options: {
            A: "Loop should stop before length(arr)",
            B: "sum should start at 1",
            C: "Return inside loop",
            D: "Use multiplication",
        },
        correct: "A" as const,
    },

    {
        id: "q-002",
        prompt: "Find the bug in this condition:",
        snippet: `if role = "admin":
    return true
return false`,
        options: {
            A: "Remove return true",
            B: "Use comparison instead of assignment",
            C: "Use != instead",
            D: "Move false inside if",
        },
        correct: "B" as const,
    },

    {
        id: "q-003",
        prompt: "Find the bug in this counter:",
        snippet: `count = 0
for each item in list:
    count = count + 2
return count`,
        options: {
            A: "Return item",
            B: "Start at 2",
            C: "Increase by 1",
            D: "Remove loop",
        },
        correct: "C" as const,
    },

    {
        id: "q-004",
        prompt: "Find the bug in search logic:",
        snippet: `for each item in list:
    if item == target:
        return false
return true`,
        options: {
            A: "Loop backwards",
            B: "Use > instead",
            C: "Remove final return",
            D: "Should return true when found",
        },
        correct: "D" as const,
    },

    {
        id: "q-005",
        prompt: "Find the bug in min tracking:",
        snippet: `min = 0
for each n in nums:
    if n < min:
        min = n
return min`,
        options: {
            A: "Initialize with first element",
            B: "Use max",
            C: "Set min = 1",
            D: "Compare opposite",
        },
        correct: "A" as const,
    },

    {
        id: "q-006",
        prompt: "Find the bug in swap logic:",
        snippet: `a = b
b = a`,
        options: {
            A: "Reverse lines",
            B: "Need temporary variable",
            C: "Add loop",
            D: "Convert type",
        },
        correct: "B" as const,
    },

    {
        id: "q-007",
        prompt: "Find the bug in average logic:",
        snippet: `sum = 0
for each n in nums:
    sum = sum + n
return sum`,
        options: {
            A: "Multiply values",
            B: "Start sum at 1",
            C: "Need divide by count",
            D: "Remove loop",
        },
        correct: "C" as const,
    },

    {
        id: "q-008",
        prompt: "Find the bug in last element access:",
        snippet: `return arr[length(arr)]`,
        options: {
            A: "Return all",
            B: "Use arr[1]",
            C: "Reverse array",
            D: "Use length(arr)-1",
        },
        correct: "D" as const,
    },

    {
        id: "q-009",
        prompt: "Find the bug in flag setup:",
        snippet: `found = true
for each item in list:
    if item == target:
        found = false
return found`,
        options: {
            A: "Initial flag wrong",
            B: "Loop missing continue",
            C: "Return inside loop",
            D: "Use count",
        },
        correct: "A" as const,
    },

    {
        id: "q-010",
        prompt: "Find the bug in division:",
        snippet: `return total / 0`,
        options: {
            A: "Use multiply",
            B: "Cannot divide by zero",
            C: "Return zero",
            D: "Remove total",
        },
        correct: "B" as const,
    },

    {
        id: "q-011",
        prompt: "Find the bug in equality check:",
        snippet: `if a != b:
    return equal`,
        options: {
            A: "Swap variables",
            B: "Use >",
            C: "Return should indicate not equal",
            D: "Remove if",
        },
        correct: "C" as const,
    },

    {
        id: "q-012",
        prompt: "Find the bug in multiplication loop:",
        snippet: `product = 0
for each n in nums:
    product = product * n`,
        options: {
            A: "Remove loop",
            B: "Use addition",
            C: "Return inside loop",
            D: "Should start at 1",
        },
        correct: "D" as const,
    },

    {
        id: "q-013",
        prompt: "Find the bug in reverse access:",
        snippet: `for i from length(arr) to 0:
    print arr[i]`,
        options: {
            A: "Start from length(arr)-1",
            B: "Start at 1",
            C: "Print i only",
            D: "Use forward loop",
        },
        correct: "A" as const,
    },

    {
        id: "q-014",
        prompt: "Find the bug in string compare:",
        snippet: `if name == null:
    print length(name)`,
        options: {
            A: "Use number",
            B: "Null check should avoid length access",
            C: "Remove print",
            D: "Compare differently",
        },
        correct: "B" as const,
    },

    {
        id: "q-015",
        prompt: "Find the bug in nested loop:",
        snippet: `for i in rows:
    for j in cols:
        print rows[i]`,
        options: {
            A: "Swap loops",
            B: "Remove outer loop",
            C: "Inner loop should use cols[j]",
            D: "Use break",
        },
        correct: "C" as const,
    },

    {
        id: "q-016",
        prompt: "Find the bug in counter reset:",
        snippet: `for each row:
    count = 0
count = count + 1`,
        options: {
            A: "Use array",
            B: "Start count at 1",
            C: "Remove reset",
            D: "Increment inside loop",
        },
        correct: "D" as const,
    },

    {
        id: "q-017",
        prompt: "Find the bug in boolean logic:",
        snippet: `if isReady and isReady:
start()`,
        options: {
            A: "Duplicate condition",
            B: "Use false",
            C: "Remove if",
            D: "Use OR only",
        },
        correct: "A" as const,
    },

    {
        id: "q-018",
        prompt: "Find the bug in append logic:",
        snippet: `list = []
list[1] = value`,
        options: {
            A: "Use remove",
            B: "First index usually starts at 0",
            C: "Use null",
            D: "Clear list",
        },
        correct: "B" as const,
    },

    {
        id: "q-019",
        prompt: "Find the bug in loop increment:",
        snippet: `i = 0
while i < 5:
    print i`,
        options: {
            A: "Start at 1",
            B: "Use for loop",
            C: "Missing increment of i",
            D: "Remove print",
        },
        correct: "C" as const,
    },

    {
        id: "q-020",
        prompt: "Find the bug in return logic:",
        snippet: `if valid:
    return success
return success`,
        options: {
            A: "Swap returns",
            B: "Remove if",
            C: "Use loop",
            D: "Both branches same",
        },
        correct: "D" as const,
    },

    {
        id: "q-021",
        prompt: "Find the bug in this max calculation:",
        snippet: `max = 0
for each n in nums:
    if n > max:
        max = n
return max`,
        options: {
            A: "Fails when all numbers are negative",
            B: "Should use < instead of >",
            C: "max should start at 1",
            D: "Return inside loop",
        },
        correct: "A" as const,
    },

    {
        id: "q-022",
        prompt: "Find the bug in this equality branch:",
        snippet: `if score > 10:
    return "pass"
else if score > 20:
    return "excellent"`,
        options: {
            A: "Need another loop",
            B: "Conditions are in wrong order",
            C: "Use == instead of >",
            D: "Remove else if",
        },
        correct: "B" as const,
    },

    {
        id: "q-023",
        prompt: "Find the bug in this array copy logic:",
        snippet: `for i from 0 to length(arr)-1:
    arr2[i+1] = arr[i]`,
        options: {
            A: "Loop should start at 1",
            B: "Should use arr[i+1]",
            C: "Copy starts at wrong index",
            D: "Remove indexing",
        },
        correct: "C" as const,
    },

    {
        id: "q-024",
        prompt: "Find the bug in this sum function:",
        snippet: `function add(a, b):
    print a + b`,
        options: {
            A: "Remove function",
            B: "Should multiply",
            C: "Should use one argument",
            D: "It prints instead of returning",
        },
        correct: "D" as const,
    },

    {
        id: "q-025",
        prompt: "Find the bug in this null handling:",
        snippet: `if user != null:
    return user.name.length
return user.name`,
        options: {
            A: "Null case still accesses user",
            B: "Should remove length",
            C: "Need loop before return",
            D: "Use number instead of name",
        },
        correct: "A" as const,
    },

    {
        id: "q-026",
        prompt: "Find the bug in this counting loop:",
        snippet: `count = 0
for i from 1 to 10:
    count = count + i
return i`,
        options: {
            A: "Loop should start at 0",
            B: "Returns wrong variable",
            C: "count should start at 1",
            D: "Use multiplication",
        },
        correct: "B" as const,
    },

    {
        id: "q-027",
        prompt: "Find the bug in this duplicate check:",
        snippet: `seen = empty set
for each item in list:
    add item to seen
    if item in seen:
        return true
return false`,
        options: {
            A: "Return false inside loop",
            B: "Should use array not set",
            C: "Check happens after insert",
            D: "Remove seen",
        },
        correct: "C" as const,
    },

    {
        id: "q-028",
        prompt: "Find the bug in this remainder logic:",
        snippet: `if n % 2 == 1:
    return "even"
else:
    return "odd"`,
        options: {
            A: "Use n % 3",
            B: "Should use division",
            C: "Remove else",
            D: "Even and odd labels are swapped",
        },
        correct: "D" as const,
    },

    {
        id: "q-029",
        prompt: "Find the bug in this length check:",
        snippet: `if length(list) < 0:
    return "empty"`,
        options: {
            A: "Length cannot be negative",
            B: "Should use loop",
            C: "Use > 0",
            D: "Return number only",
        },
        correct: "A" as const,
    },

    {
        id: "q-030",
        prompt: "Find the bug in this first element access:",
        snippet: `if length(arr) == 0:
    return arr[0]
return null`,
        options: {
            A: "Should use arr[1]",
            B: "Accesses first element when array is empty",
            C: "Reverse the condition",
            D: "Remove null",
        },
        correct: "B" as const,
    },

    {
        id: "q-031",
        prompt: "Find the bug in this factorial logic:",
        snippet: `result = 0
for i from 1 to n:
    result = result * i
return result`,
        options: {
            A: "Use addition not multiplication",
            B: "Loop should start at 0",
            C: "Result should start at 1",
            D: "Return i",
        },
        correct: "C" as const,
    },

    {
        id: "q-032",
        prompt: "Find the bug in this string loop:",
        snippet: `for i from 0 to length(text)-1:
    print text[length(text)]`,
        options: {
            A: "Use numbers not text",
            B: "Should print i only",
            C: "Loop should start at 1",
            D: "Uses out-of-range index every time",
        },
        correct: "D" as const,
    },

    {
        id: "q-033",
        prompt: "Find the bug in this minimum comparison:",
        snippet: `if a > b:
    return a
return b`,
        options: {
            A: "Returns maximum, not minimum",
            B: "Should use loop",
            C: "Need three variables",
            D: "Remove return",
        },
        correct: "A" as const,
    },

    {
        id: "q-034",
        prompt: "Find the bug in this loop condition:",
        snippet: `i = 10
while i < 0:
    print i
    i = i - 1`,
        options: {
            A: "Should increment i",
            B: "Loop never runs with starting value 10",
            C: "Use array instead",
            D: "Remove print",
        },
        correct: "B" as const,
    },

    {
        id: "q-035",
        prompt: "Find the bug in this search result:",
        snippet: `for each item in list:
    if item == target:
        return item
return item`,
        options: {
            A: "Loop should start at 1",
            B: "Should return target inside loop",
            C: "Returns last item when target not found",
            D: "Use break only",
        },
        correct: "C" as const,
    },

    {
        id: "q-036",
        prompt: "Find the bug in this password check:",
        snippet: `if password.length > 8:
    return "too short"`,
        options: {
            A: "Use number 0",
            B: "Should use loop",
            C: "Length should be removed",
            D: "Condition message is reversed",
        },
        correct: "D" as const,
    },

    {
        id: "q-037",
        prompt: "Find the bug in this reset logic:",
        snippet: `total = 0
for each n in nums:
    total = 0
    total = total + n
return total`,
        options: {
            A: "total resets inside loop",
            B: "Should subtract n",
            C: "Start total at 1",
            D: "Return inside loop",
        },
        correct: "A" as const,
    },

    {
        id: "q-038",
        prompt: "Find the bug in this nested index use:",
        snippet: `for i from 0 to rows-1:
    for j from 0 to cols-1:
        grid[i][i] = 0`,
        options: {
            A: "Should use one loop only",
            B: "Uses i twice instead of i and j",
            C: "Grid should be text",
            D: "Set value to 1",
        },
        correct: "B" as const,
    },

    {
        id: "q-039",
        prompt: "Find the bug in this boundary check:",
        snippet: `if index > 0 and index < length(arr):
    return arr[index]`,
        options: {
            A: "Remove return",
            B: "Should use > length(arr)",
            C: "Excludes index 0 incorrectly",
            D: "Use multiplication",
        },
        correct: "C" as const,
    },

    {
        id: "q-040",
        prompt: "Find the bug in this boolean return:",
        snippet: `if isValid:
    return false
else:
    return true`,
        options: {
            A: "Need loop",
            B: "Should remove else",
            C: "Use numbers instead",
            D: "Returns opposite of expected logic",
        },
        correct: "D" as const,
    },

    {
        id: "q-041",
        prompt: "Find the bug in this average denominator:",
        snippet: `sum = 0
for each n in nums:
    sum = sum + n
return sum / (length(nums) - 1)`,
        options: {
            A: "Wrong denominator for average",
            B: "Should multiply sum",
            C: "Loop should start at 1",
            D: "Remove return",
        },
        correct: "A" as const,
    },

    {
        id: "q-042",
        prompt: "Find the bug in this last index loop:",
        snippet: `for i from 0 to length(arr)-1:
    if arr[i] == target:
        lastIndex = i
return i`,
        options: {
            A: "Should return arr[i]",
            B: "Returns loop variable instead of lastIndex",
            C: "Loop must go backward",
            D: "Remove assignment",
        },
        correct: "B" as const,
    },

    {
        id: "q-043",
        prompt: "Find the bug in this empty-string check:",
        snippet: `if text == "":
    return text[0]`,
        options: {
            A: "Remove condition",
            B: "Should use text[1]",
            C: "Cannot access first character of empty text",
            D: "Use number 0",
        },
        correct: "C" as const,
    },

    {
        id: "q-044",
        prompt: "Find the bug in this range test:",
        snippet: `if age < 18 and age > 60:
    return "special group"`,
        options: {
            A: "Use only one comparison always",
            B: "Should use multiplication",
            C: "Remove return",
            D: "Condition can never be true",
        },
        correct: "D" as const,
    },

    {
        id: "q-045",
        prompt: "Find the bug in this loop update:",
        snippet: `i = 0
while i < length(arr):
    i = i + 2
    process arr[i]`,
        options: {
            A: "Skips first element and may go out of bounds",
            B: "Should decrement i",
            C: "Use text instead of array",
            D: "Remove process",
        },
        correct: "A" as const,
    },

    {
        id: "q-046",
        prompt: "Find the bug in this assignment chain:",
        snippet: `x = 5
y = x
x = 10
return y + x`,
        options: {
            A: "Should return x only",
            B: "Assuming y changes with x is wrong",
            C: "Use loop",
            D: "Set x to 0",
        },
        correct: "B" as const,
    },

    {
        id: "q-047",
        prompt: "Find the bug in this break usage:",
        snippet: `for each item in list:
    if item != target:
        break
return "found"`,
        options: {
            A: "Use continue only",
            B: "Should remove loop",
            C: "Break condition is reversed",
            D: "Return number",
        },
        correct: "C" as const,
    },

    {
        id: "q-048",
        prompt: "Find the bug in this sum of positives:",
        snippet: `sum = 0
for each n in nums:
    if n < 0:
        sum = sum + n
return sum`,
        options: {
            A: "Return n",
            B: "Should start sum at 1",
            C: "Use multiplication",
            D: "Adds negatives instead of positives",
        },
        correct: "D" as const,
    },

    {
        id: "q-049",
        prompt: "Find the bug in this index-based compare:",
        snippet: `for i from 0 to length(arr)-1:
    if arr[i] == arr[i+1]:
        return true`,
        options: {
            A: "Last iteration accesses i+1 out of bounds",
            B: "Should compare arr[i] with arr[i]",
            C: "Loop should start at 1",
            D: "Remove return true",
        },
        correct: "A" as const,
    },

    {
        id: "q-050",
        prompt: "Find the bug in this fallback logic:",
        snippet: `if config exists:
    use defaultConfig
else:
    use config`,
        options: {
            A: "Should use loop",
            B: "Uses default and actual config in reverse",
            C: "Remove else",
            D: "Use null only",
        },
        correct: "B" as const,
    },

    {
        id: "q-051",
        prompt: "Find the bug in this running total:",
        snippet: `total = 0
for each n in nums:
    total = n
return total`,
        options: {
            A: "Use division",
            B: "Should start total at 1",
            C: "Overwrites total instead of accumulating",
            D: "Return inside loop",
        },
        correct: "C" as const,
    },

    {
        id: "q-052",
        prompt: "Find the bug in this empty check:",
        snippet: `if length(items) != 0:
    return "empty"`,
        options: {
            A: "Remove return",
            B: "Should use a loop",
            C: "Use multiplication",
            D: "Condition meaning is reversed",
        },
        correct: "D" as const,
    },

    {
        id: "q-053",
        prompt: "Find the bug in this index loop:",
        snippet: `for i from 0 to length(arr):
    print arr[i]`,
        options: {
            A: "Loop goes one step too far",
            B: "Should start at 1",
            C: "Use arr[length(arr)] only",
            D: "Remove print",
        },
        correct: "A" as const,
    },

    {
        id: "q-054",
        prompt: "Find the bug in this condition chain:",
        snippet: `if score >= 90:
    return "A"
if score >= 80:
    return "B"
if score >= 70:
    return "B"`,
        options: {
            A: "Conditions need a loop",
            B: "Last grade label should be different",
            C: "Use < instead of >=",
            D: "Remove first condition",
        },
        correct: "B" as const,
    },

    {
        id: "q-055",
        prompt: "Find the bug in this first match logic:",
        snippet: `for each item in list:
    if item == target:
        match = item
return match`,
        options: {
            A: "Use array not list",
            B: "Should return target immediately",
            C: "match may be undefined if target not found",
            D: "Loop should go backward",
        },
        correct: "C" as const,
    },

    {
        id: "q-056",
        prompt: "Find the bug in this countdown:",
        snippet: `i = 5
while i > 0:
    print i
    i = i + 1`,
        options: {
            A: "Remove while",
            B: "Should start at 0",
            C: "Use multiplication",
            D: "Counter moves in wrong direction",
        },
        correct: "D" as const,
    },

    {
        id: "q-057",
        prompt: "Find the bug in this max update:",
        snippet: `max = nums[0]
for each n in nums:
    if n < max:
        max = n
return max`,
        options: {
            A: "Comparison tracks minimum, not maximum",
            B: "Should start max at 0",
            C: "Loop should start at 1 only",
            D: "Return n",
        },
        correct: "A" as const,
    },

    {
        id: "q-058",
        prompt: "Find the bug in this duplicate finder:",
        snippet: `for i from 0 to length(arr)-1:
    for j from i+1 to length(arr)-1:
        if arr[i] != arr[j]:
            return true
return false`,
        options: {
            A: "Inner loop should start at 0",
            B: "Condition should detect equality, not inequality",
            C: "Return false inside loop",
            D: "Use one loop only",
        },
        correct: "B" as const,
    },

    {
        id: "q-059",
        prompt: "Find the bug in this password rule:",
        snippet: `if password.length < 8:
    return "strong"`,
        options: {
            A: "Need a loop",
            B: "Should use > 100",
            C: "Short password labeled incorrectly",
            D: "Remove length",
        },
        correct: "C" as const,
    },

    {
        id: "q-060",
        prompt: "Find the bug in this array initialization:",
        snippet: `arr = [1, 2, 3]
for i from 0 to 3:
    arr[i] = 0`,
        options: {
            A: "Remove assignment",
            B: "Should start at 1",
            C: "Use text array instead",
            D: "Last iteration uses invalid index",
        },
        correct: "D" as const,
    },

    {
        id: "q-061",
        prompt: "Find the bug in this divisor check:",
        snippet: `if n % 2 == 0:
    return "odd"
else:
    return "even"`,
        options: {
            A: "Even and odd results are swapped",
            B: "Should use division by 3",
            C: "Need another if",
            D: "Remove else",
        },
        correct: "A" as const,
    },

    {
        id: "q-062",
        prompt: "Find the bug in this nested sum:",
        snippet: `sum = 0
for each row in grid:
    for each val in row:
        row = sum + val
return sum`,
        options: {
            A: "Should use multiplication",
            B: "Updates wrong variable inside loop",
            C: "Return row",
            D: "Remove inner loop",
        },
        correct: "B" as const,
    },

    {
        id: "q-063",
        prompt: "Find the bug in this substring logic:",
        snippet: `start = 0
end = length(text)
return text[start to end+1]`,
        options: {
            A: "Use numbers only",
            B: "Should start at 1",
            C: "End goes past valid range",
            D: "Remove return",
        },
        correct: "C" as const,
    },

    {
        id: "q-064",
        prompt: "Find the bug in this membership check:",
        snippet: `for each item in list:
    if item == target:
        found = true
return false`,
        options: {
            A: "Use != always",
            B: "Should use break only",
            C: "Loop should start at 1",
            D: "Ignores found flag and always returns false",
        },
        correct: "D" as const,
    },

    {
        id: "q-065",
        prompt: "Find the bug in this two-number compare:",
        snippet: `if a == b:
    return "different"`,
        options: {
            A: "Equality case returns wrong label",
            B: "Should use loop",
            C: "Need third number",
            D: "Remove return",
        },
        correct: "A" as const,
    },

    {
        id: "q-066",
        prompt: "Find the bug in this reverse copy:",
        snippet: `for i from 0 to length(arr)-1:
    reversed[i] = arr[i]`,
        options: {
            A: "Should use multiplication",
            B: "Copies original order instead of reverse",
            C: "Remove indexing",
            D: "Loop should not exist",
        },
        correct: "B" as const,
    },

    {
        id: "q-067",
        prompt: "Find the bug in this average initialization:",
        snippet: `count = 0
sum = 0
average = sum / count`,
        options: {
            A: "count should start at 1 always",
            B: "Should use multiplication",
            C: "Division by zero before counting",
            D: "Remove sum",
        },
        correct: "C" as const,
    },

    {
        id: "q-068",
        prompt: "Find the bug in this case check:",
        snippet: `if text == "YES":
    return true
if text == "yes":
    return false`,
        options: {
            A: "Use numbers only",
            B: "Should remove first if",
            C: "Need a loop",
            D: "Same meaning handled inconsistently",
        },
        correct: "D" as const,
    },

    {
        id: "q-069",
        prompt: "Find the bug in this boundary logic:",
        snippet: `if index >= 0 and index <= length(arr):
    return arr[index]`,
        options: {
            A: "Allows index equal to length(arr)",
            B: "Should reject index 0",
            C: "Remove return",
            D: "Use < 0 only",
        },
        correct: "A" as const,
    },

    {
        id: "q-070",
        prompt: "Find the bug in this counting condition:",
        snippet: `count = 0
for each n in nums:
    if n > 0:
        count = count - 1
return count`,
        options: {
            A: "Should start count at 1",
            B: "Count changes in wrong direction",
            C: "Use multiplication",
            D: "Remove condition",
        },
        correct: "B" as const,
    },

    {
        id: "q-071",
        prompt: "Find the bug in this last element removal:",
        snippet: `remove arr[length(arr)]`,
        options: {
            A: "Need a loop",
            B: "Should remove arr[0]",
            C: "Uses invalid last index",
            D: "Should add instead",
        },
        correct: "C" as const,
    },

    {
        id: "q-072",
        prompt: "Find the bug in this boolean flag:",
        snippet: `isSorted = true
for i from 0 to length(arr)-2:
    if arr[i] > arr[i+1]:
        isSorted = true
return isSorted`,
        options: {
            A: "Remove return",
            B: "Loop should start at 1",
            C: "Use multiplication",
            D: "Flag should become false on disorder",
        },
        correct: "D" as const,
    },

    {
        id: "q-073",
        prompt: "Find the bug in this total price logic:",
        snippet: `total = price
for each item in cart:
    total = total + price`,
        options: {
            A: "Adds same price repeatedly instead of item price",
            B: "Should subtract price",
            C: "Start total at 0 only",
            D: "Remove loop",
        },
        correct: "A" as const,
    },

    {
        id: "q-074",
        prompt: "Find the bug in this retry loop:",
        snippet: `attempts = 0
while attempts < 3:
    if success:
        continue
    attempts = attempts + 1`,
        options: {
            A: "Should start attempts at 1",
            B: "Success path can loop forever",
            C: "Use multiplication",
            D: "Remove while",
        },
        correct: "B" as const,
    },

    {
        id: "q-075",
        prompt: "Find the bug in this square check:",
        snippet: `if x * x = 9:
    return true`,
        options: {
            A: "Use x + x",
            B: "Should return false",
            C: "Uses assignment instead of comparison",
            D: "Remove if",
        },
        correct: "C" as const,
    },

    {
        id: "q-076",
        prompt: "Find the bug in this sum-until-target logic:",
        snippet: `sum = 0
for each n in nums:
    if sum == target:
        break
return sum + n`,
        options: {
            A: "Remove break",
            B: "Should start sum at 1",
            C: "Use multiplication",
            D: "May use n outside safe intended context",
        },
        correct: "D" as const,
    },

    {
        id: "q-077",
        prompt: "Find the bug in this pair comparison:",
        snippet: `for i from 0 to length(arr)-1:
    if arr[i] > arr[i-1]:
        print "increasing"`,
        options: {
            A: "First iteration uses invalid previous index",
            B: "Should compare with arr[i+2]",
            C: "Remove print",
            D: "Use == only",
        },
        correct: "A" as const,
    },

    {
        id: "q-078",
        prompt: "Find the bug in this login rule:",
        snippet: `if username == "" and password == "":
    return "valid"`,
        options: {
            A: "Should use loop",
            B: "Empty credentials accepted incorrectly",
            C: "Remove password",
            D: "Use numbers instead",
        },
        correct: "B" as const,
    },

    {
        id: "q-079",
        prompt: "Find the bug in this list build:",
        snippet: `result = []
for each item in source:
    result = item`,
        options: {
            A: "Use multiplication",
            B: "Should start with null",
            C: "Replaces list instead of appending items",
            D: "Remove loop",
        },
        correct: "C" as const,
    },

    {
        id: "q-080",
        prompt: "Find the bug in this min finder:",
        snippet: `min = nums[0]
for i from 1 to length(nums)-1:
    if nums[i] > min:
        min = nums[i]
return min`,
        options: {
            A: "Return i",
            B: "Loop should start at 0",
            C: "Use multiplication",
            D: "Comparison updates toward maximum, not minimum",
        },
        correct: "D" as const,
    },

    {
        id: "q-082",
        prompt: "Find the bug in this search condition:",
        snippet: `for each item in list:
    if item != target:
        return true
return false`,
        options: {
            A: "Returns true for non-target items",
            B: "Should remove return false",
            C: "Use multiplication",
            D: "Loop should start at 1",
        },
        correct: "A" as const,
    },

    {
        id: "q-084",
        prompt: "Find the bug in this division check:",
        snippet: `if divisor != 0:
    return number / 0`,
        options: {
            A: "Should multiply instead",
            B: "Divides by zero despite safety check",
            C: "Remove condition",
            D: "Use divisor = 1",
        },
        correct: "B" as const,
    },

    {
        id: "q-085",
        prompt: "Find the bug in this descending loop:",
        snippet: `for i from 10 to 0:
    print i`,
        options: {
            A: "Use multiplication",
            B: "Should start from 0",
            C: "Missing clear decrement/update direction",
            D: "Remove print",
        },
        correct: "C" as const,
    },

    {
        id: "q-086",
        prompt: "Find the bug in this login comparison:",
        snippet: `if username = savedUsername and password = savedPassword:
    return true`,
        options: {
            A: "Use loop instead",
            B: "Should return false",
            C: "Remove password check",
            D: "Uses assignment instead of comparison",
        },
        correct: "D" as const,
    },

    {
        id: "q-087",
        prompt: "Find the bug in this total item count:",
        snippet: `count = length(cart) - 1
return count`,
        options: {
            A: "Subtracts 1 without reason",
            B: "Should multiply by 1",
            C: "Use loop instead",
            D: "Return cart",
        },
        correct: "A" as const,
    },

    {
        id: "q-088",
        prompt: "Find the bug in this max loop:",
        snippet: `max = nums[0]
for i from 0 to length(nums)-1:
    if nums[i] > max:
        max = nums[0]
return max`,
        options: {
            A: "Should use minimum instead",
            B: "Resets max to first element instead of nums[i]",
            C: "Loop should start at 1 only",
            D: "Remove return",
        },
        correct: "B" as const,
    },

    {
        id: "q-089",
        prompt: "Find the bug in this boolean condition:",
        snippet: `if age >= 18 or age <= 60:
    return "allowed"`,
        options: {
            A: "Remove return",
            B: "Should use multiplication",
            C: "Condition is too broad and almost always true",
            D: "Use age == 18 only",
        },
        correct: "C" as const,
    },

    {
        id: "q-090",
        prompt: "Find the bug in this copy loop:",
        snippet: `for i from 0 to length(source)-1:
    destination[0] = source[i]`,
        options: {
            A: "Use multiplication",
            B: "Should use source[0] only",
            C: "Remove loop",
            D: "Writes every value to same index",
        },
        correct: "D" as const,
    },

    {
        id: "q-091",
        prompt: "Find the bug in this minimum setup:",
        snippet: `min = nums[1]
for each n in nums:
    if n < min:
        min = n
return min`,
        options: {
            A: "Fails for arrays with fewer than two elements",
            B: "Should use maximum instead",
            C: "Use multiplication",
            D: "Remove loop",
        },
        correct: "A" as const,
    },

    {
        id: "q-092",
        prompt: "Find the bug in this empty list logic:",
        snippet: `if length(list) == 0:
    return list[0]
else:
    return "not empty"`,
        options: {
            A: "Should return list[1]",
            B: "Accesses first element of empty list",
            C: "Use multiplication",
            D: "Remove else",
        },
        correct: "B" as const,
    },

    {
        id: "q-093",
        prompt: "Find the bug in this update counter:",
        snippet: `updates = 0
for each item in items:
    if needsUpdate:
        updates = updates + 1
return item`,
        options: {
            A: "Use multiplication",
            B: "Should start updates at 1",
            C: "Returns wrong variable instead of updates",
            D: "Return inside loop",
        },
        correct: "C" as const,
    },

    {
        id: "q-094",
        prompt: "Find the bug in this string match:",
        snippet: `if text contains keyword:
    return false
return true`,
        options: {
            A: "Need a loop always",
            B: "Should remove return true",
            C: "Use multiplication",
            D: "Returns opposite of expected result",
        },
        correct: "D" as const,
    },

    {
        id: "q-095",
        prompt: "Find the bug in this duplicate flag:",
        snippet: `hasDuplicate = false
for i from 0 to length(arr)-2:
    if arr[i] == arr[i+1]:
        hasDuplicate = false
return hasDuplicate`,
        options: {
            A: "Flag should become true when duplicate found",
            B: "Loop should start at 1",
            C: "Use nested loops only",
            D: "Remove flag",
        },
        correct: "A" as const,
    },

    {
        id: "q-096",
        prompt: "Find the bug in this number check:",
        snippet: `if n % 2 == 0:
    return "prime"`,
        options: {
            A: "Should use multiplication",
            B: "Even check does not mean prime",
            C: "Remove return",
            D: "Use n % 3 only",
        },
        correct: "B" as const,
    },

    {
        id: "q-097",
        prompt: "Find the bug in this matrix traversal:",
        snippet: `for i from 0 to rows-1:
    for j from 0 to cols-1:
        print grid[j][i]`,
        options: {
            A: "Remove print",
            B: "Should use one loop only",
            C: "Row and column indexes are swapped",
            D: "Use multiplication",
        },
        correct: "C" as const,
    },

    {
        id: "q-098",
        prompt: "Find the bug in this stop condition:",
        snippet: `i = 0
while i <= length(arr):
    i = i + 1`,
        options: {
            A: "Remove while",
            B: "Should decrement i",
            C: "Use array value instead",
            D: "Loop condition runs one step too far",
        },
        correct: "D" as const,
    },

    {
        id: "q-099",
        prompt: "Find the bug in this discount logic:",
        snippet: `if price > 100:
    finalPrice = price + 10`,
        options: {
            A: "Adds instead of applying a discount",
            B: "Should remove condition",
            C: "Use multiplication only",
            D: "Set price to 0",
        },
        correct: "A" as const,
    },

    {
        id: "q-100",
        prompt: "Find the bug in this found-index logic:",
        snippet: `index = -1
for i from 0 to length(arr)-1:
    if arr[i] == target:
        index = i
        break
return i`,
        options: {
            A: "Should remove break",
            B: "Returns loop variable instead of index",
            C: "Use multiplication",
            D: "Start index at 0",
        },
        correct: "B" as const,
    }
]


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

const SCORE_RULES = {
    roleCorrect: 4,
    roleWrong: -4,
    voterCorrect: 2,
    voterWrong: -2,
    tieCorrect: 1,
    tieWrong: -1,
    autoPickPenalty: -2,
} as const;

type ScoringMode = "normal" | "tie";

type ScoreUpdate = {
    scoreboard: Record<string, number>;
    wrongAnswersCount: Record<string, number>;
    scoreMilestonesMs: Record<string, Record<string, number>>;
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

function buildWrongAnswersCountForPlayers(current: RoomState): Record<string, number> {
    const next: Record<string, number> = {};
    const source = current.status !== "lobby" ? current.wrongAnswersCount : {};

    for (const player of current.players) {
        const existing = source[player.id];
        next[player.id] = Number.isInteger(existing) && existing >= 0 ? existing : 0;
    }

    return next;
}

function buildFreshWrongAnswersCountForPlayers(current: RoomState): Record<string, number> {
    const next: Record<string, number> = {};

    for (const player of current.players) {
        next[player.id] = 0;
    }

    return next;
}

function buildScoreMilestonesForPlayers(
    current: RoomState
): Record<string, Record<string, number>> {
    const next: Record<string, Record<string, number>> = {};
    const source = current.status !== "lobby" ? current.scoreMilestonesMs : {};

    for (const player of current.players) {
        const milestones = source[player.id];
        if (!milestones || typeof milestones !== "object") {
            next[player.id] = {};
            continue;
        }

        const normalized: Record<string, number> = {};
        for (const [scoreKey, reachedAtMs] of Object.entries(milestones)) {
            if (Number.isInteger(reachedAtMs) && reachedAtMs >= 0) {
                normalized[scoreKey] = reachedAtMs;
            }
        }
        next[player.id] = normalized;
    }

    return next;
}

function buildFreshScoreMilestonesForPlayers(
    current: RoomState,
    now: number
): Record<string, Record<string, number>> {
    const next: Record<string, Record<string, number>> = {};

    for (const player of current.players) {
        next[player.id] = {
            "0": now,
        };
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

function applyScoreDelta(update: ScoreUpdate, playerId: string, delta: number, now: number) {
    if (update.scoreboard[playerId] === undefined) {
        return;
    }

    if (delta === 0) {
        return;
    }

    const previousScore = update.scoreboard[playerId] ?? 0;
    const nextScore = previousScore + delta;
    update.scoreboard[playerId] = nextScore;

    if (delta < 0) {
        update.wrongAnswersCount[playerId] = (update.wrongAnswersCount[playerId] ?? 0) + 1;
    }

    const nextScoreKey = String(nextScore);
    const milestones = update.scoreMilestonesMs[playerId] ?? {};
    if (milestones[nextScoreKey] === undefined) {
        milestones[nextScoreKey] = now;
    }
    update.scoreMilestonesMs[playerId] = milestones;
}

function resolveRoleDelta(
    isCorrect: boolean,
    isAutoPicked: boolean,
    mode: ScoringMode
): number {
    if (isAutoPicked) {
        return SCORE_RULES.autoPickPenalty;
    }

    if (mode === "tie") {
        return isCorrect ? SCORE_RULES.tieCorrect : SCORE_RULES.tieWrong;
    }

    return isCorrect ? SCORE_RULES.roleCorrect : SCORE_RULES.roleWrong;
}

function resolveVoterDelta(isCorrect: boolean, mode: ScoringMode): number {
    if (mode === "tie") {
        return isCorrect ? SCORE_RULES.tieCorrect : SCORE_RULES.tieWrong;
    }

    return isCorrect ? SCORE_RULES.voterCorrect : SCORE_RULES.voterWrong;
}

function applyRoundScoring(
    state: InRoundRoomState,
    mode: ScoringMode,
    now: number
): ScoreUpdate {
    const update: ScoreUpdate = {
        scoreboard: buildScoreboardForPlayers(state),
        wrongAnswersCount: buildWrongAnswersCountForPlayers(state),
        scoreMilestonesMs: buildScoreMilestonesForPlayers(state),
    };
    const question = getQuestionById(state.questionId);
    if (!question) {
        return update;
    }

    if (state.proposerPick) {
        const proposerIsCorrect = state.proposerPick === question.correct;
        const proposerDelta = resolveRoleDelta(
            proposerIsCorrect,
            state.proposerAutoPicked,
            mode
        );
        applyScoreDelta(update, state.proposerPlayerId, proposerDelta, now);
    }

    if (state.counterPlayerId && state.counterPick) {
        const counterIsCorrect = state.counterPick === question.correct;
        const counterDelta = resolveRoleDelta(counterIsCorrect, state.counterAutoPicked, mode);
        applyScoreDelta(update, state.counterPlayerId, counterDelta, now);
    }

    for (const player of state.players) {
        const voterPlayerId = player.id;
        if (voterPlayerId === state.proposerPlayerId || voterPlayerId === state.counterPlayerId) {
            continue;
        }

        const voteTarget = state.votes[voterPlayerId];
        if (!voteTarget) {
            continue;
        }

        const votedPick = getRoundPickByTarget(state, voteTarget);
        if (!votedPick) {
            continue;
        }

        const voterDelta = resolveVoterDelta(votedPick === question.correct, mode);
        applyScoreDelta(update, voterPlayerId, voterDelta, now);
    }

    return update;
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
                proposerAutoPicked: false,
                counterAutoPicked: false,
                proposerPick: null,
                proposerReason: null,
                counterPick: null,
                counterReason: null,
                systemAlternativePick: null,
                votes: {},
                finalDecision: null,
                finalCorrect: null,
                scoreboard: buildFreshScoreboardForPlayers(current),
                wrongAnswersCount: buildFreshWrongAnswersCountForPlayers(current),
                scoreMilestonesMs: buildFreshScoreMilestonesForPlayers(current, now),
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
                    proposerAutoPicked: true,
                };
            }

            if (workingState.phase === "counter" && workingState.counterPlayerId && !workingState.counterPick) {
                workingState = {
                    ...workingState,
                    counterPick: pickRandomItem(ALL_OPTIONS),
                    counterReason: workingState.counterReason ?? "Auto-picked due to counter timeout.",
                    counterAutoPicked: true,
                };
            }

            if (workingState.phase === "vote") {
                const correctOption = getCorrectOptionForQuestion(workingState.questionId);
                const voteOutcome = resolveVoteOutcome(workingState);
                if (voteOutcome.kind === "tie") {
                    const tieScoreUpdate = applyRoundScoring(workingState, "tie", now);
                    return {
                        ok: true,
                        state: {
                            ...workingState,
                            phase: "reveal",
                            phaseEndsAtMs: now + PHASE_DURATION_MS.reveal,
                            finalDecision: null,
                            finalCorrect: null,
                            correctOption,
                            scoreboard: tieScoreUpdate.scoreboard,
                            wrongAnswersCount: tieScoreUpdate.wrongAnswersCount,
                            scoreMilestonesMs: tieScoreUpdate.scoreMilestonesMs,
                            updatedAtMs: now,
                        },
                    };
                }

                const resolvedDecision = voteOutcome.decision;
                const finalCorrect = computeFinalCorrect(workingState, resolvedDecision);
                const scoreUpdate = applyRoundScoring(workingState, "normal", now);

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
                            scoreboard: scoreUpdate.scoreboard,
                            wrongAnswersCount: scoreUpdate.wrongAnswersCount,
                            scoreMilestonesMs: scoreUpdate.scoreMilestonesMs,
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
                        scoreboard: scoreUpdate.scoreboard,
                        wrongAnswersCount: scoreUpdate.wrongAnswersCount,
                        scoreMilestonesMs: scoreUpdate.scoreMilestonesMs,
                        updatedAtMs: now,
                    },
                };
            }

            if (workingState.phase === "final") {
                const resolvedDecision = resolveFinalDecision(workingState);
                const finalCorrect = computeFinalCorrect(workingState, resolvedDecision);
                const scoreUpdate = applyRoundScoring(workingState, "normal", now);
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
                            scoreboard: scoreUpdate.scoreboard,
                            wrongAnswersCount: scoreUpdate.wrongAnswersCount,
                            scoreMilestonesMs: scoreUpdate.scoreMilestonesMs,
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
                        scoreboard: scoreUpdate.scoreboard,
                        wrongAnswersCount: scoreUpdate.wrongAnswersCount,
                        scoreMilestonesMs: scoreUpdate.scoreMilestonesMs,
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
                        proposerAutoPicked: false,
                        counterAutoPicked: false,
                        proposerPick: null,
                        proposerReason: null,
                        counterPick: null,
                        counterReason: null,
                        systemAlternativePick: null,
                        votes: {},
                        finalDecision: null,
                        finalCorrect: null,
                        scoreboard: buildScoreboardForPlayers(workingState),
                        wrongAnswersCount: buildWrongAnswersCountForPlayers(workingState),
                        scoreMilestonesMs: buildScoreMilestonesForPlayers(workingState),
                        updatedAtMs: now,
                    },
                };
            }

            if (workingState.phase === "counter" && shouldEndGameImmediatelyForDifferentWrongPicks(workingState)) {
                const scoreUpdate = applyRoundScoring(workingState, "normal", now);
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
                        scoreboard: scoreUpdate.scoreboard,
                        wrongAnswersCount: scoreUpdate.wrongAnswersCount,
                        scoreMilestonesMs: scoreUpdate.scoreMilestonesMs,
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
