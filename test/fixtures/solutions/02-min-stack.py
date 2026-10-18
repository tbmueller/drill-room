class MinStack:
    def __init__(self):
        self.items = []
        self.mins = []

    def push(self, x):
        self.items.append(x)
        self.mins.append(min(x, self.mins[-1]) if self.mins else x)

    def pop(self):
        if not self.items:
            return None
        self.mins.pop()
        return self.items.pop()

    def top(self):
        return self.items[-1] if self.items else None

    def get_min(self):
        return self.mins[-1] if self.mins else None
