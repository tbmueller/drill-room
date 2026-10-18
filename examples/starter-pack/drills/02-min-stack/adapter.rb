# Replays [op, value?] pairs against a new MinStack and collects every return value except push's.
def drill_room_adapt(min_stack, args)
  stack = min_stack.new
  out = []
  args["ops"].each do |op, x|
    case op
    when "push" then stack.push(x)
    when "pop" then out << stack.pop
    when "top" then out << stack.top
    when "min" then out << stack.min
    else raise ArgumentError, "Unknown op #{op}"
    end
  end
  out
end
