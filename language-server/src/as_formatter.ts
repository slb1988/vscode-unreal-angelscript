/**
 * AS formatter — pure token-stream approach, no DB/typedb dependency.
 *
 * Entry point: formatASSource(source: string): string
 *
 * Strategy: mirrors ParseScopeIntoStatements from as_parser.ts.
 * We split the flat token stream into "line groups" at the same boundaries
 * the parser uses (semicolons at paren-depth-0, brace-scope detection),
 * then re-emit each group with canonical spacing.
 *
 * Style rules (matching the existing repo code style):
 *  - 4-space indentation
 *  - Space after control-flow keywords before '('
 *  - No space between function/method name and '('
 *  - Space around binary operators; no space around unary prefix/postfix
 *  - Space after ',' but not before
 *  - No space inside parentheses, after '.', after '::', after '->'
 *  - K&R brace style: '{' on same line as declaration
 *  - '}' on its own line; trailing ';' after class/struct closing brace preserved
 *  - Blank line between top-level / class-level members (mirrors original blanks)
 *  - UPROPERTY / UFUNCTION / UCLASS / USTRUCT macro stays on its own line
 *  - Line comments preserved and re-indented; trailing comments kept inline
 *  - Block comments re-indented
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

enum TK {
    Whitespace,
    Newline,
    LineComment,
    BlockComment,
    Identifier,
    Number,
    String,
    Punct,
    EOF,
}

interface Token {
    kind: TK;
    text: string;
}

// A single "line" unit for formatting
interface LineUnit {
    kind: "blank" | "comment" | "preproc" | "statement" | "scope";
    tokens: Token[];
    trailingComment?: Token;
    children?: LineUnit[];
    closingSemi?: boolean;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const RE_NEWLINE   = /^\r?\n/;
const RE_WS        = /^[ \t]+/;
const RE_BLOCK_CMT = /^\/\*[\s\S]*?\*\//;
const RE_LINE_CMT  = /^\/\/[^\r\n]*/;
const RE_DQ_STR    = /^(?:f"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*")/;
const RE_SQ_STR    = /^'(?:[^'\\]|\\.)*'/;
const RE_NUMBER    = /^(?:0x[0-9A-Fa-f]+|0b[01]+|0o[0-7]+|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?[fFlLuU]*)/;
const RE_IDENT     = /^[A-Za-z_][A-Za-z0-9_]*/;
const RE_PUNCT     = /^(?:<<=|>>=|\.\.\.|\|\||&&|==|!=|<=|>=|<<|>>|\+\+|--|->|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|~=|::|\.\.|[{}()\[\]<>.,;:!~+\-*/%&|^=?@#])/;

function lex(source: string): Token[]
{
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < source.length)
    {
        const rest = source.slice(pos);
        let m: RegExpMatchArray | null;

        if      ((m = rest.match(RE_NEWLINE)))       tokens.push({ kind: TK.Newline,      text: m[0] });
        else if ((m = rest.match(RE_WS)))            tokens.push({ kind: TK.Whitespace,   text: m[0] });
        else if ((m = rest.match(RE_BLOCK_CMT)))     tokens.push({ kind: TK.BlockComment, text: m[0] });
        else if ((m = rest.match(RE_LINE_CMT)))      tokens.push({ kind: TK.LineComment,  text: m[0] });
        else if ((m = rest.match(RE_DQ_STR)))        tokens.push({ kind: TK.String,       text: m[0] });
        else if ((m = rest.match(RE_SQ_STR)))        tokens.push({ kind: TK.String,       text: m[0] });
        else if ((m = rest.match(RE_NUMBER)))        tokens.push({ kind: TK.Number,       text: m[0] });
        else if ((m = rest.match(RE_IDENT)))         tokens.push({ kind: TK.Identifier,   text: m[0] });
        else if ((m = rest.match(RE_PUNCT)))         tokens.push({ kind: TK.Punct,        text: m[0] });
        else { tokens.push({ kind: TK.Punct, text: rest[0] }); m = [rest[0]]; }

        pos += m[0].length;
    }

    tokens.push({ kind: TK.EOF, text: "" });
    return tokens;
}

// ---------------------------------------------------------------------------
// Splitter — mirrors ParseScopeIntoStatements from as_parser.ts
// ---------------------------------------------------------------------------

// Macro keywords that live on their own line, with no trailing semicolon.
// The variable/function declaration that follows is a separate statement.
const MACRO_KEYWORDS = new Set(["UPROPERTY", "UFUNCTION", "UCLASS", "USTRUCT"]);

class Splitter
{
    private tokens: Token[];
    private idx: number = 0;

    constructor(tokens: Token[]) { this.tokens = tokens; }

    private peek(): Token { return this.tokens[this.idx] ?? { kind: TK.EOF, text: "" }; }
    private advance(): Token { return this.tokens[this.idx++] ?? { kind: TK.EOF, text: "" }; }

    private skipWS(): void
    {
        while (this.peek().kind === TK.Whitespace || this.peek().kind === TK.Newline)
            this.idx++;
    }

    private skipHWS(): void
    {
        while (this.peek().kind === TK.Whitespace)
            this.idx++;
    }

    private countBlankLines(): number
    {
        let newlines = 0, blanks = 0, i = this.idx;
        while (i < this.tokens.length)
        {
            const k = this.tokens[i].kind;
            if (k === TK.Newline) { newlines++; if (newlines > 1) blanks++; i++; }
            else if (k === TK.Whitespace) { i++; }
            else break;
        }
        return blanks;
    }

    split(): LineUnit[] { return this.readScope(); }

    private readScope(): LineUnit[]
    {
        const units: LineUnit[] = [];

        while (true)
        {
            const blanks = this.countBlankLines();
            this.skipWS();

            const t = this.peek();
            if (t.kind === TK.EOF) break;
            if (t.kind === TK.Punct && t.text === "}") break;

            if (blanks > 0 && units.length > 0)
                units.push({ kind: "blank", tokens: [] });

            if (t.kind === TK.LineComment)
            {
                this.advance();
                units.push({ kind: "comment", tokens: [t] });
                continue;
            }

            if (t.kind === TK.BlockComment)
            {
                this.advance();
                units.push({ kind: "comment", tokens: [t] });
                continue;
            }

            if (t.kind === TK.Punct && t.text === "#")
            {
                units.push({ kind: "preproc", tokens: this.readUntilNewline() });
                continue;
            }

            units.push(this.readStatementOrScope());
        }

        return units;
    }

    private readUntilNewline(): Token[]
    {
        const toks: Token[] = [];
        while (true)
        {
            const t = this.peek();
            if (t.kind === TK.EOF || t.kind === TK.Newline) break;
            this.advance();
            if (t.kind !== TK.Whitespace) toks.push(t);
        }
        return toks;
    }

    private readStatementOrScope(): LineUnit
    {
        const codeToks: Token[] = [];
        let trailingComment: Token | undefined;
        let parenDepth = 0;

        while (true)
        {
            const t = this.peek();
            if (t.kind === TK.EOF) break;

            if (t.kind === TK.Whitespace || t.kind === TK.Newline) { this.advance(); continue; }

            if (t.kind === TK.LineComment)
            {
                this.advance();
                trailingComment = t;
                break;
            }

            if (t.kind === TK.BlockComment) { this.advance(); continue; }

            if (t.kind === TK.Punct)
            {
                if (t.text === "(") parenDepth++;
                if (t.text === ")") parenDepth--;

                if (parenDepth === 0)
                {
                    if (t.text === ";")
                    {
                        this.advance(); codeToks.push(t);
                        this.skipHWS();
                        if (this.peek().kind === TK.LineComment)
                            trailingComment = this.advance();
                        break;
                    }

                    if (t.text === "{")
                    {
                        this.advance();
                        const children = this.readScope();
                        if (this.peek().kind === TK.Punct && this.peek().text === "}")
                            this.advance();
                        this.skipHWS();
                        let closingSemi = false;
                        if (this.peek().kind === TK.Punct && this.peek().text === ";")
                        {
                            this.advance();
                            closingSemi = true;
                        }
                        return { kind: "scope", tokens: codeToks, trailingComment, children, closingSemi };
                    }

                    if (t.text === "}") break;
                }
            }

            // MACRO keyword at statement start — read name + '(...)' and stop.
            // The declaration on the following line is a separate statement.
            if (parenDepth === 0 && codeToks.length === 0 &&
                t.kind === TK.Identifier && MACRO_KEYWORDS.has(t.text))
            {
                codeToks.push(this.advance()); // macro name
                this.skipWS();

                if (this.peek().kind === TK.Punct && this.peek().text === "(")
                {
                    codeToks.push(this.advance()); // '('
                    parenDepth = 1;
                    while (parenDepth > 0)
                    {
                        const mt = this.advance();
                        if (mt.kind === TK.EOF) break;
                        if (mt.kind === TK.Whitespace || mt.kind === TK.Newline) continue;
                        if (mt.kind === TK.Punct && mt.text === "(") parenDepth++;
                        if (mt.kind === TK.Punct && mt.text === ")") parenDepth--;
                        codeToks.push(mt);
                    }
                    parenDepth = 0;
                }
                break;
            }

            this.advance();
            codeToks.push(t);
        }

        return { kind: "statement", tokens: codeToks, trailingComment };
    }
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

const INDENT_UNIT = "\t";
const MAX_LINE = 100;

const KEYWORD_SPACE_BEFORE_PAREN = new Set([
    "if", "else", "for", "while", "switch", "return", "case",
]);

// Operators that are always binary (never unary prefix)
const BINARY_OPS = new Set([
    "*", "/", "%", "&", "|", "^",
    "==", "!=", "<=", ">=", "<<", ">>", "&&", "||",
    "=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "~=", "<<=", ">>=",
]);

class Emitter
{
    private depth: number = 0;
    private out: string[] = [];

    emit(units: LineUnit[]): string
    {
        this.emitUnits(units);
        return this.out.join("\r\n").trimEnd() + "\r\n";
    }

    private emitUnits(units: LineUnit[]): void
    {
        for (let i = 0; i < units.length; i++)
        {
            const u = units[i];

            if (u.kind === "blank")
            {
                if (i > 0 && i < units.length - 1) this.out.push("");
                continue;
            }

            if (u.kind === "comment")
            {
                const tok = u.tokens[0];
                if (!tok) continue;
                if (tok.kind === TK.LineComment)
                    this.out.push(this.indent() + tok.text.trimEnd());
                else
                    this.emitBlockComment(tok.text);
                continue;
            }

            if (u.kind === "preproc")
            {
                this.out.push(this.indent() + u.tokens.map(t => t.text).join(""));
                continue;
            }

            if (u.kind === "statement")
            {
                if (u.tokens.length === 0) continue;
                const line = this.formatTokens(u.tokens, this.depth, this.depth + 1);
                const trail = u.trailingComment ? "  " + u.trailingComment.text.trimEnd() : "";
                if (isControlFlowHeader(u.tokens) && i + 1 < units.length)
                {
                    const next = units[i + 1];
                    if (next && next.kind === "statement" && next.tokens.length > 0)
                    {
                        this.out.push(this.indent() + line + trail);
                        this.depth++;
                        const bodyLine = this.formatTokens(next.tokens, this.depth, this.depth + 1);
                        const bodyTrail = next.trailingComment ? "  " + next.trailingComment.text.trimEnd() : "";
                        this.out.push(this.indent() + bodyLine + bodyTrail);
                        this.depth--;
                        i++;
                        continue;
                    }
                }
                this.out.push(this.indent() + line + trail);
                continue;
            }

            if (u.kind === "scope")
            {
                const header = u.tokens.length > 0 ? this.formatTokens(u.tokens, this.depth, this.depth + 1) : "";
                const trail = u.trailingComment ? "  " + u.trailingComment.text.trimEnd() : "";
                if (header) this.out.push(this.indent() + header + trail);
                this.out.push(this.indent() + "{");
                this.depth++;
                this.emitUnits(u.children ?? []);
                this.depth--;
                this.out.push(this.indent() + "}" + (u.closingSemi ? ";" : ""));
                continue;
            }
        }
    }

    private indent(): string { return INDENT_UNIT.repeat(this.depth); }

    private emitBlockComment(text: string): void
    {
        const lines = text.split(/\r?\n/);
        const ind = this.indent();
        this.out.push(ind + lines[0]);
        for (let i = 1; i < lines.length; i++)
            this.out.push(ind + " " + lines[i].replace(/^[ \t]*/, ""));
    }

    // ------------------------------------------------------------------
    // Token list → formatted string.
    // May contain embedded newlines when a line exceeds MAX_LINE chars —
    // wraps at ',' boundaries without breaking any single token,
    // mirroring the logic in code_actions.ts / parsed_completion.ts.
    // ------------------------------------------------------------------

    private formatTokens(tokens: Token[], baseTabDepth: number, wrapTabDepth: number): string
    {
        if (tokens.length === 0) return "";

        const TAB_WIDTH = 4;

        let hasSemi = false;
        while (tokens.length > 0
            && tokens[tokens.length - 1].kind === TK.Punct
            && tokens[tokens.length - 1].text === ";")
        {
            tokens = tokens.slice(0, -1);
            hasSemi = true;
        }

        let result = "";
        let last = "";
        let col = baseTabDepth * TAB_WIDTH;
        let parenDepth = 0;
        const parenColStack: number[] = [];

        const app = (s: string): void =>
        {
            if (result.endsWith(" ") && s.startsWith(" ")) s = s.slice(1);
            result += s;
            const nl = s.lastIndexOf("\n");
            if (nl >= 0) col = s.length - nl - 1;
            else col += s.length;
            if (s.trim()) last = s.trim();
        };

        // Approximate length of next argument — tokens from startIdx to the next
        // ',' or ')' at depth 0 relative to startIdx (without breaking any word).
        const nextArgLen = (startIdx: number): number =>
        {
            let len = 0, depth = 0;
            for (let j = startIdx; j < tokens.length; j++)
            {
                const tk = tokens[j];
                if (tk.kind === TK.Whitespace || tk.kind === TK.Newline) continue;
                if (tk.kind === TK.Punct)
                {
                    if (tk.text === "(" || tk.text === "[") { depth++; len += 1; continue; }
                    if (tk.text === ")" || tk.text === "]")
                    {
                        if (depth === 0) break;
                        depth--; len += 1; continue;
                    }
                    if (tk.text === "," && depth === 0) break;
                }
                len += tk.text.length + 1;
            }
            return len;
        };

        const wrapStr = "\r\n" + "\t".repeat(wrapTabDepth);
        const wrapCol = wrapTabDepth * TAB_WIDTH;

        for (let i = 0; i < tokens.length; i++)
        {
            const t = tokens[i];

            if (t.kind === TK.Punct && t.text === "(")
            {
                parenDepth++;
                app(spacedPunct("(", last, tokens, i));
                parenColStack.push(col);
                // Wrap before first arg if the whole arg list would overflow
                if (col + nextArgLen(i + 1) > MAX_LINE)
                {
                    result += wrapStr;
                    col = wrapCol;
                }
                continue;
            }

            if (t.kind === TK.Punct && t.text === ")")
            {
                parenDepth--;
                parenColStack.pop();
                app(")");
                continue;
            }

            if (t.kind === TK.Punct && t.text === "," && parenDepth > 0)
            {
                if (col + 2 + nextArgLen(i + 1) > MAX_LINE)
                {
                    result += "," + wrapStr;
                    col = wrapCol;
                    last = ",";
                    continue;
                }
                app(", ");
                continue;
            }

            if (t.kind === TK.Identifier) { app(spaceBefore(last) + t.text); continue; }
            if (t.kind === TK.Number || t.kind === TK.String) { app(spaceBefore(last) + t.text); continue; }
            if (t.kind === TK.Punct) { app(spacedPunct(t.text, last, tokens, i)); continue; }
            app(t.text);
        }

        return result + (hasSemi ? ";" : "");
    }
}

// ---------------------------------------------------------------------------
// Spacing helpers
// ---------------------------------------------------------------------------

// Control-flow keywords that can have a braceless single-statement body
const CONTROL_FLOW_KEYWORDS = new Set(["if", "for", "while", "else"]);

function isControlFlowHeader(tokens: Token[]): boolean
{
    if (tokens.length === 0) return false;
    const first = tokens[0];
    if (first.kind !== TK.Identifier || !CONTROL_FLOW_KEYWORDS.has(first.text)) return false;
    const last = tokens[tokens.length - 1];
    if (last.kind === TK.Punct && last.text === ";") return false;
    return true;
}

function spaceBefore(last: string): string
{
    if (!last) return "";
    // no space after these tokens
    if (/^[(\[<~!@]$/.test(last) || last === "::" || last === "->" || last === ".") return "";
    // no space between unary +/- and the following number or identifier
    if (last === "-" || last === "+") return "";
    return " ";
}

function spacedPunct(text: string, last: string, tokens: Token[], i: number): string
{
    switch (text)
    {
        case "(":
            return (KEYWORD_SPACE_BEFORE_PAREN.has(last) || last === "return") ? " (" : "(";
        case ")": return ")";
        case "[": return "[";
        case "]": return "]";

        case ",":  return ", ";
        case ";":  return ";";
        case ".":  return ".";
        case "::": return "::";
        case "->": return "->";
        case ":":  return " :";   // class inheritance, ternary, for-each, case

        case "++": case "--": return text;

        case "~":
            return (last && /[A-Za-z0-9_)\]]$/.test(last)) ? " ~" : "~";
        case "!":
            return (last && /[A-Za-z0-9_)\]]$/.test(last)) ? " !" : "!";

        case "*": case "&":
            if (last && /[A-Za-z0-9_>\]]$/.test(last)) return " " + text;
            return text;

        case "<":
            // Template syntax: no space before '<' after identifier
            return "<";
        case ">":
            return ">";

        case "+": case "-":
        {
            // "return -x" — unary but needs a leading space after keyword
            if (last === "return") return " " + text;
            // Unary when previous token is not an operand
            const prevIsOperand = last !== "" && /[A-Za-z0-9_)\]"]$/.test(last);
            if (!prevIsOperand) return text;
            return " " + text + " ";
        }

        default:
            if (BINARY_OPS.has(text)) return " " + text + " ";
            return text;
    }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function formatASSource(source: string): string
{
    const tokens = lex(source);
    const units  = new Splitter(tokens).split();
    return new Emitter().emit(units);
}
