// Source map for the C++ demo, NOT interpreted. Keep the @demo markers.
int64 Add(int64 A, int64 B)
{
    int64 Result = A + B; // @demo:add
    return Result; // @demo:return
}

void Main()
{
    int64 Counter = 1; // @demo:init
    while (true)
    {
        Counter = Add(Counter, 2); // @demo:call
        Demo::State.LastResult = Counter; // @demo:store
        Counter += 1; // @demo:increment
        Demo::Print(Counter); // @demo:print
    }
}
