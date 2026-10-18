class MinStack {
  private items: number[] = [];
  private mins: number[] = [];

  push(x: number): void {
    this.items.push(x);
    this.mins.push(this.mins.length ? Math.min(x, this.mins[this.mins.length - 1]) : x);
  }

  pop(): number | null {
    this.mins.pop();
    return this.items.length ? this.items.pop()! : null;
  }

  top(): number | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  getMin(): number | null {
    return this.mins.length ? this.mins[this.mins.length - 1] : null;
  }
}
