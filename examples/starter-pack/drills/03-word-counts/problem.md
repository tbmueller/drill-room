# Word counts

A two-part problem. Each part builds on the last, and part 2 unlocks once part 1's hidden tests pass.

A **word** is a run of letters `a`–`z` (any case) and apostrophes. Everything else separates words. Compare words in lowercase.

## Part 1: Count

Write `countWords(text)`: return an object mapping each word to how many times it appears.

```
"The cat and the hat." → { "the": 2, "cat": 1, "and": 1, "hat": 1 }
```

## Part 2: Top k

Write `topWords(text, k)`: return the `k` most frequent words as `[word, count]` pairs, most frequent first. Break ties alphabetically. If there are fewer than `k` distinct words, return them all.

```
topWords("b a b c a b", 2) → [["b", 3], ["a", 2]]
```

## Decisions for this version

- Input is plain ASCII.
- (Part 2) `k` is at least 1.
