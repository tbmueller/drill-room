// Replays [op, value?] pairs against a new MinStack and collects every return value except push's.
export default function adapt(MinStack, args) {
  const stack = new MinStack();
  const out = [];
  for (const [op, x] of args.ops) {
    if (op === "push") stack.push(x);
    else if (op === "pop") out.push(stack.pop() ?? null);
    else if (op === "top") out.push(stack.top() ?? null);
    else if (op === "min") out.push(stack.getMin() ?? null);
    else throw new Error(`Unknown op ${op}`);
  }
  return out;
}
