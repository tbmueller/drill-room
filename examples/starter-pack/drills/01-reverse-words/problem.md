Given a string, return its words in **reverse order**, joined by single spaces.

- Words are separated by one or more spaces, tabs or newlines.
- Ignore leading and trailing whitespace.
- An input with no words returns `""`.

## Example

```
"  the quick\tbrown   fox "
→ "fox brown quick the"
```

## Watch for

Splitting on `" "` keeps empty strings between repeated spaces.
