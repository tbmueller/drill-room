def count_words(text)
  text.downcase.scan(/[a-z']+/).tally
end

def top_words(text, k)
  count_words(text).sort_by { |w, n| [-n, w] }.first(k)
end
