class MinStack
  def initialize
    @items = []
    @mins = []
  end

  def push(x)
    @items << x
    @mins << (@mins.empty? ? x : [x, @mins.last].min)
  end

  def pop
    @mins.pop
    @items.pop
  end

  def top
    @items.last
  end

  def min
    @mins.last
  end
end
