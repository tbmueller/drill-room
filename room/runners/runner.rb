# Judge runner for Ruby submissions.
#
# Usage: ruby runner.rb <solution.rb> <spec.json> <cases.json>
# spec.json is {name, args, adapter}: the method or class to look up, the
# arguments to pass in order (a case's arg name, or {value} for a fixed value),
# and an optional adapter file defining drill_room_adapt(target, args).
# Prints one line: MARKER + JSON list of {ok, got | error, logs}.
require "json"
require "stringio"
require "set"

MARKER = "@@DRILLROOM_RESULTS@@"
REAL_STDOUT = $stdout

# Symbols become strings and Sets become arrays, so results compare like JSON.
def drill_room_plain(value)
  case value
  when Hash then value.each_with_object({}) { |(k, v), h| h[k.to_s] = drill_room_plain(v) }
  when Array, Set then value.map { |v| drill_room_plain(v) }
  when Symbol then value.to_s
  else value
  end
end

def solution_line(e)
  (e.backtrace || []).each do |l|
    m = l.match(/solution\.rb:(\d+)/)
    return m[1] if m
  end
  nil
end

path, spec_path, cases_path = ARGV
spec = JSON.parse(File.read(spec_path))
cases = JSON.parse(File.read(cases_path))

fail_all = lambda do |msg, logs = []|
  REAL_STDOUT.puts MARKER + JSON.generate(cases.map { { "ok" => false, "error" => msg, "logs" => logs } })
  exit 0
end

load_buf = StringIO.new
begin
  $stdout = load_buf
  load path
rescue SyntaxError, StandardError, NotImplementedError => e
  $stdout = REAL_STDOUT
  text = e.message.gsub(path, "solution.rb")
  msg = e.is_a?(SyntaxError) ? "SyntaxError: #{text.lines.first(4).join.strip}" : "#{e.class}: #{text}"
  fail_all.call(msg, load_buf.string.lines.map(&:chomp))
ensure
  $stdout = REAL_STDOUT
end
load_logs = load_buf.string.lines.map(&:chomp)

if spec["adapter"]
  begin
    load spec["adapter"]
  rescue SyntaxError, StandardError => e
    fail_all.call("The pack's adapter couldn't load: #{e.class}: #{e.message}")
  end
end

name = spec["name"]
target =
  if name.match?(/\A[A-Z]/)
    Object.const_defined?(name) ? Object.const_get(name) : nil
  elsif respond_to?(name.to_sym, true)
    method(name.to_sym)
  end
fail_all.call("NameError: #{name} is not defined. Keep the name from the starter code.", load_logs) if target.nil?

results = cases.each_with_index.map do |c, i|
  buf = StringIO.new
  buf.write(load_buf.string) if i.zero?
  begin
    $stdout = buf
    args = JSON.parse(JSON.generate(c["args"]))
    got =
      if spec["adapter"]
        drill_room_adapt(target, args)
      elsif target.respond_to?(:call)
        target.call(*spec["args"].map { |a| a.is_a?(String) ? args[a] : a["value"] })
      else
        raise TypeError, "#{name} is a class; this drill needs an adapter"
      end
    got = drill_room_plain(got)
    JSON.generate(got)
    { "ok" => true, "got" => got, "logs" => buf.string.lines.map(&:chomp) }
  rescue StandardError, NotImplementedError, SystemStackError => e
    line = solution_line(e)
    where = line ? " (line #{line})" : ""
    { "ok" => false, "error" => "#{e.class}: #{e.message}#{where}", "logs" => buf.string.lines.map(&:chomp) }
  ensure
    $stdout = REAL_STDOUT
  end
end
REAL_STDOUT.puts MARKER + JSON.generate(results)
