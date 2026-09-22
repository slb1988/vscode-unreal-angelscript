# AngelScript Formatter — Rules Reference

Source: `language-server/src/as_formatter.ts`  
JS reference: `language-server/test_formatter.js`

---

## Architecture

```
source string
    └─ lex()          → Token[]
    └─ Splitter.split() → LineUnit[]
    └─ Emitter.emit()  → formatted string
```

The formatter is a pure token-stream pass — no AST, no type database.

### Lexer

Tokenises in priority order:

| Token kind     | Pattern example                              |
|----------------|----------------------------------------------|
| `Newline`      | `\r?\n`                                      |
| `Whitespace`   | spaces / tabs (non-newline)                  |
| `BlockComment` | `/* … */`                                    |
| `LineComment`  | `// …`                                       |
| `String`       | `"…"`, `f"…"`, `'…'`                        |
| `Number`       | `0x…`, `0b…`, `0o…`, decimal with suffix    |
| `Identifier`   | `[A-Za-z_][A-Za-z0-9_]*`                    |
| `Punct`        | multi-char ops first (`<<=`, `||`, `::`, …) |

### Splitter

Mirrors `ParseScopeIntoStatements` from `as_parser.ts`. Produces `LineUnit[]`:

- **`blank`** — one or more blank lines between statements (at most one is emitted)
- **`comment`** — standalone `//` or `/* */` comment
- **`preproc`** — `#include` / `#pragma` etc. (starts with `#`)
- **`statement`** — everything up to `;` at paren-depth 0, or a bare control-flow header (see below)
- **`scope`** — statement header + `{ children }` block

**Braceless control-flow split**: after reading a control-flow keyword (`if`, `for`, `while`, `else`) and its closing `)` at depth 0, if the next non-whitespace token is **not** `{`, the splitter breaks immediately. The body becomes the next separate `statement` unit.

**Macro keywords** (`UPROPERTY`, `UFUNCTION`, `UCLASS`, `USTRUCT`): read name + `(…)` and stop. The declaration on the following line is a separate statement.

---

## Style Rules

### Indentation

- Unit: **`\t`** (one tab per depth level)
- Scope body is depth + 1
- Braceless control-flow body is depth + 1 (emitted then depth restored)

### Brace style — Allman

```angelscript
void Foo()
{
    // body
}
```

- `{` always on its own line, at current indentation depth
- `}` always on its own line, at current indentation depth
- Trailing `;` after `}` preserved for `class`/`struct` (e.g. `};`)

### Braceless control-flow

```angelscript
if (condition)
    return false;
```

- Header emitted at current depth
- Body emitted at depth + 1
- Only the immediate next statement is consumed — no chaining

### Blank lines

- Blank lines from source are preserved (collapsed to **at most one**)
- Leading and trailing blank lines in a scope are dropped

### Comments

- Standalone `//` line: re-indented to current depth, text preserved verbatim
- Trailing `//` comment: kept on the same line, separated by two spaces
- Block `/* */` comment: first line at current indent; subsequent lines at current indent + one space, with leading whitespace stripped

### Macros (UPROPERTY etc.)

```angelscript
UPROPERTY(EditAnywhere, Category = "Angle")
float HalfAngle = 45.f;
```

Each macro and its following declaration are separate statements — they are never merged.

---

## Spacing Rules

### Keywords before `(`

Space inserted for: `if`, `else`, `for`, `while`, `switch`, `return`, `case`

```angelscript
if (x)   for (…)   return (…)
```

No space for function/method calls:

```angelscript
Foo(x)   Cast<T>(…)
```

### Operators

| Category | Rule | Example |
|---|---|---|
| Binary ops | space on both sides | `a + b`, `x == y`, `a += 1` |
| Unary prefix `+` / `-` | no leading space if previous token is not an operand | `-x`, `return -y` (space before after `return`) |
| `++` / `--` | no spaces | `i++`, `--j` |
| `!` | space before if previous is operand, no space otherwise | `!flag`, `a && !b` |
| `~` | same rule as `!` | `~mask` |
| `*` / `&` | space before if previous is operand (binary), no space otherwise (pointer/ref) | `a * b` vs `T* ptr` |

### Delimiters

| Token | Rule |
|---|---|
| `(` `)` | no space inside |
| `[` `]` | no space inside |
| `<` `>` | no space (templates) |
| `,` | no space before, one space after |
| `;` | no space before |
| `.` | no space on either side |
| `::` | no space on either side |
| `->` | no space on either side |
| `:` | one space before (inheritance, ternary, for-each, `case`) |

---

## Line Length Limit

```
MAX_LINE = 100
TAB_WIDTH = 4   (for column tracking only — actual indent chars are \t)
```

Wrapping only happens inside argument lists (at `,` boundaries). No token is ever split.

### Column tracking

- `col` starts at `baseTabDepth × TAB_WIDTH`
- Each appended string advances `col` by its character length
- After a wrap, `col` resets to `wrapTabDepth × TAB_WIDTH`

### Wrap trigger — after `(`

If `col + length_of_first_arg > MAX_LINE`, wrap immediately after `(`:

```angelscript
FVector RefDir = Cast<UPLAIBehaviorComponent>(
    ControlledPawn.GetComponentByClass(UPLAIBehaviorComponent::StaticClass()));
```

### Wrap trigger — after `,`

If `col + 2 + length_of_next_arg > MAX_LINE`, replace `, ` with `,\r\n\t…`:

```angelscript
float AngleDeg = Math::RadiansToDegrees(
    Math::Acos(Math::Clamp(DotResult, -1.f, 1.f)));
```

### Wrap indentation

Continuation lines use `\t` × `(depth + 1)` — **not** column-aligned to `(`.

---

## Line Endings

Output uses **`\r\n`** (Windows CRLF).  
Input accepts both `\n` and `\r\n` (normalised by lexer).

---

## Configuration Constants

| Constant | Value | Location |
|---|---|---|
| `INDENT_UNIT` | `"\t"` | `Emitter` |
| `MAX_LINE` | `100` | `Emitter` |
| `TAB_WIDTH` | `4` | `formatTokens` |
| `MACRO_KEYWORDS` | `UPROPERTY UFUNCTION UCLASS USTRUCT` | `Splitter` |
| `KEYWORD_SPACE_BEFORE_PAREN` | `if else for while switch return case` | `Emitter` |
| `CONTROL_FLOW_KEYWORDS` | `if for while else` | `isControlFlowHeader` |
| `BINARY_OPS` | `* / % & \| ^ == != <= >= << >> && \|\| = += -= …` | `Emitter` |

---

## Known Limitations / Future Work

- **`else if` chains**: each `else` and `if` are separate units; they format correctly but as separate lines (no `else if` collapsing)
- **Long non-argument lines**: lines exceeding 100 chars that don't contain a function call are not wrapped
- **Template angle brackets**: `<` / `>` are treated as punctuation, not as balanced brackets — complex nested templates may not space correctly
- **String content**: string literals are preserved verbatim; no re-formatting inside strings
- **`const` / pointer qualifiers on wrap**: continuation alignment is tab-based, not signature-aligned
