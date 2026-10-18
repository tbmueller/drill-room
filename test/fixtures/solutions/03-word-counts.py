import re
from collections import Counter


def count_words(text):
    return dict(Counter(re.findall(r"[a-z']+", text.lower())))


def top_words(text, k):
    return sorted(count_words(text).items(), key=lambda e: (-e[1], e[0]))[:k]
