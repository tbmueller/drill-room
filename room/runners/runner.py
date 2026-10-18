"""Judge runner for Python submissions.

Usage: python3 runner.py <solution.py> <spec.json> <cases.json>
spec.json is {name, args, adapter}: the function or class to look up, the
arguments to pass in order (a case's arg name, or {value} for a fixed value),
and an optional adapter file defining adapt(target, args).
Prints one line: MARKER + JSON list of {ok, got | error, logs}.
"""
import contextlib
import io
import json
import sys

MARKER = "@@DRILLROOM_RESULTS@@"


def plain(v):
    """Tuples and sets become lists and dict keys become strings, so they compare like JSON."""
    if isinstance(v, (list, tuple, set, frozenset)):
        return [plain(x) for x in v]
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    return v


def solution_line(e):
    tb = e.__traceback__
    line = None
    while tb:
        if tb.tb_frame.f_code.co_filename == "solution.py":
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def main():
    path, spec_path, cases_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(spec_path) as f:
        spec = json.load(f)
    with open(cases_path) as f:
        cases = json.load(f)
    real_stdout = sys.stdout

    def fail_all(msg, logs=()):
        out = [{"ok": False, "error": msg, "logs": list(logs)} for _ in cases]
        real_stdout.write(MARKER + json.dumps(out) + "\n")

    adapt = None
    if spec.get("adapter"):
        try:
            with open(spec["adapter"]) as f:
                adapter_ns = {"__name__": "adapter"}
                exec(compile(f.read(), "adapter.py", "exec"), adapter_ns)
            adapt = adapter_ns["adapt"]
        except Exception as e:
            fail_all(f"The pack's adapter couldn't load: {type(e).__name__}: {e}")
            return

    ns = {"__name__": "solution"}
    load_logs = io.StringIO()
    try:
        with open(path) as f:
            src = f.read()
        with contextlib.redirect_stdout(load_logs):
            exec(compile(src, "solution.py", "exec"), ns)
    except Exception as e:  # syntax or top-level error: fail every case the same way
        line = getattr(e, "lineno", None)
        msg = f"{type(e).__name__}: {e}"
        if isinstance(e, SyntaxError) and line:
            msg = f"SyntaxError on line {line}: {e.msg}"
        fail_all(msg, load_logs.getvalue().splitlines())
        return

    name = spec["name"]
    if name not in ns:
        fail_all(f"NameError: {name} is not defined. Keep the name from the starter code.",
                 load_logs.getvalue().splitlines())
        return
    target = ns[name]

    results = []
    for i, c in enumerate(cases):
        buf = io.StringIO()
        if i == 0:
            buf.write(load_logs.getvalue())
        try:
            args = json.loads(json.dumps(c["args"]))
            with contextlib.redirect_stdout(buf):
                if adapt:
                    got = adapt(target, args)
                else:
                    got = target(*[args[a] if isinstance(a, str) else a["value"] for a in spec["args"]])
            got = plain(got)
            json.dumps(got)  # must be serialisable
            results.append({"ok": True, "got": got, "logs": buf.getvalue().splitlines()})
        except Exception as e:
            line = solution_line(e)
            where = f" (line {line})" if line else ""
            results.append({"ok": False, "error": f"{type(e).__name__}: {e}{where}", "logs": buf.getvalue().splitlines()})
    real_stdout.write(MARKER + json.dumps(results) + "\n")


if __name__ == "__main__":
    main()
