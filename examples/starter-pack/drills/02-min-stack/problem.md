Build a stack that can also report its smallest value in constant time.

- `push(x)`: add `x` to the top.
- `pop()`: remove the top value and return it. On an empty stack, return `null` (`None` in Python, `nil` in Ruby).
- `top()`: return the top value without removing it, or `null` when empty.
- `getMin()` (`get_min` in Python, `min` in Ruby): the smallest value currently on the stack, or `null` when empty.

The judge replays a list of operations and collects what each one returns (`push` returns nothing and is skipped).

## Example

```
push 3, push 1, getMin → 1, pop → 1, getMin → 3, pop → 3, pop → null
```

## Watch for

The minimum has to survive pops: after removing the smallest value, the next smallest takes over.
