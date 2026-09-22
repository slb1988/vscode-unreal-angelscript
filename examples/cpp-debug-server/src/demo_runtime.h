#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

// This is a seven-instruction simulation, NOT an AngelScript interpreter.
// It models Main -> Add -> Main so F10/F11/Shift+F11 have different semantics.
enum class Instruction { Init, Call, Add, Return, Store, Increment, Print };

struct SourceMap
{
    std::string filename;
    std::string module;
    std::array<int, 7> lines{};

    explicit SourceMap(const std::filesystem::path& path)
    {
        filename = std::filesystem::absolute(path).lexically_normal().generic_u8string();
        module = path.stem().u8string();
        std::ifstream input(path);
        if (!input)
            throw std::runtime_error("Cannot open script: " + filename);
        const std::array<std::string, 7> markers{
            "init", "call", "add", "return", "store", "increment", "print"};
        std::string text;
        int line = 0;
        while (std::getline(input, text))
        {
            ++line;
            for (std::size_t i = 0; i < markers.size(); ++i)
            {
                if (text.find("// @demo:" + markers[i]) == std::string::npos)
                    continue;
                if (lines[i] != 0)
                    throw std::runtime_error("Duplicate source marker: " + markers[i]);
                lines[i] = line;
            }
        }
        for (std::size_t i = 0; i < markers.size(); ++i)
            if (lines[i] == 0)
                throw std::runtime_error("Missing source marker: " + markers[i]);
    }

    int line(Instruction pc) const { return lines[static_cast<std::size_t>(pc)]; }

    bool matches(const std::string& path, const std::string& moduleName) const
    {
        if (!moduleName.empty())
            return moduleName == module;
        std::string normalized = path;
        std::replace(normalized.begin(), normalized.end(), '\\', '/');
        return normalized == filename;
    }

    int breakpointLine(int requested) const
    {
        int result = std::numeric_limits<int>::max();
        for (int candidate : lines)
            if (candidate >= requested && candidate < result)
                result = candidate;
        return requested > 0 && result != std::numeric_limits<int>::max() ? result : -1;
    }
};

struct Value
{
    std::string name;
    std::string text;
    std::string type;
    bool hasMembers = false;
};

class DemoRuntime
{
public:
    Instruction pc = Instruction::Init;
    std::int64_t counter = 0, a = 0, b = 0, result = 0;
    std::int64_t lastResult = 0, executedInstructions = 0;

    int depth() const { return pc == Instruction::Add || pc == Instruction::Return ? 2 : 1; }
    void reset() { *this = DemoRuntime{}; }

    // A good Visual Studio native breakpoint: observe state BEFORE this executes.
    void executeInstruction()
    {
        ++executedInstructions;
        switch (pc)
        {
        case Instruction::Init: counter = 1; pc = Instruction::Call; break;
        case Instruction::Call: a = counter; b = 2; pc = Instruction::Add; break;
        case Instruction::Add: result = a + b; pc = Instruction::Return; break;
        case Instruction::Return: counter = result; pc = Instruction::Store; break;
        case Instruction::Store: lastResult = counter; pc = Instruction::Increment; break;
        case Instruction::Increment: ++counter; pc = Instruction::Print; break;
        case Instruction::Print:
            std::cout << "[runtime] Demo::Print(" << counter << ")\n";
            pc = Instruction::Call; // while (true), so Pause can always be demonstrated.
            break;
        }
    }

    std::vector<Value> variables(std::string path) const
    {
        int frame = 0;
        splitFrame(path, frame);
        if (frame < 0 || frame >= depth())
            return {};
        if (path == "%local%")
        {
            if (depth() == 2 && frame == 0)
            {
                std::vector<Value> values{number("A", a), number("B", b)};
                if (pc == Instruction::Return)
                    values.push_back(number("Result", result));
                return values;
            }
            return pc == Instruction::Init ? std::vector<Value>{}
                : std::vector<Value>{number("Counter", counter)};
        }
        if (path == "%module%")
            return {state()};
        if (path == "%this%")
            return {}; // Both functions are global; there is no this object.
        stripScope(path);
        if (path == "Demo::State")
            return {number("LastResult", lastResult), number("ExecutedInstructions", executedInstructions)};
        return {};
    }

    Value evaluate(std::string expression, int frame) const
    {
        const auto first = expression.find_first_not_of(" \t\r\n");
        if (first == std::string::npos)
            expression.clear();
        else
            expression = expression.substr(first, expression.find_last_not_of(" \t\r\n") - first + 1);
        splitFrame(expression, frame);
        stripScope(expression);
        if (frame < 0 || frame >= depth())
            return {expression, "<invalid stack frame>", "", false};
        if (expression == "Demo::State")
            return state();
        if (expression == "Demo::State.LastResult")
            return number(expression, lastResult);
        if (expression == "Demo::State.ExecutedInstructions")
            return number(expression, executedInstructions);
        for (const auto& value : variables(std::to_string(frame) + ":%local%"))
            if (value.name == expression)
                return value;
        return {expression, "<unavailable or unsupported expression>", "", false};
    }

private:
    static Value number(const std::string& name, std::int64_t value)
    {
        return {name, std::to_string(value), "int64", false};
    }
    Value state() const
    {
        return {"Demo::State", "{LastResult=" + std::to_string(lastResult) + "}", "FDemoState", true};
    }
    static void splitFrame(std::string& path, int& frame)
    {
        const auto colon = path.find(':');
        if (colon == std::string::npos || colon == 0
            || path.find_first_not_of("0123456789", 0) != colon)
            return;
        frame = std::stoi(path.substr(0, colon));
        path.erase(0, colon + 1);
    }
    static void stripScope(std::string& path)
    {
        for (const std::string prefix : {"%local%.", "%module%.", "%this%."})
            if (path.compare(0, prefix.size(), prefix) == 0)
            {
                path.erase(0, prefix.size());
                break;
            }
    }
};
