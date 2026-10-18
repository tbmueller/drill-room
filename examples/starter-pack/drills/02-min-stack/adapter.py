# Replays [op, value?] pairs against a new MinStack and collects every return value except push's.
def adapt(MinStack, args):
    stack = MinStack()
    out = []
    for step in args["ops"]:
        op = step[0]
        if op == "push":
            stack.push(step[1])
        elif op == "pop":
            out.append(stack.pop())
        elif op == "top":
            out.append(stack.top())
        elif op == "min":
            out.append(stack.get_min())
        else:
            raise ValueError(f"Unknown op {op}")
    return out
