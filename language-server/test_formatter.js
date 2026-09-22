"use strict";
const fs = require("fs");

const TK = { Whitespace:0, Newline:1, LineComment:2, BlockComment:3, Identifier:4, Number:5, String:6, Punct:7, EOF:8 };

const RE_NEWLINE   = /^\r?\n/;
const RE_WS        = /^[ \t]+/;
const RE_BLOCK_CMT = /^\/\*[\s\S]*?\*\//;
const RE_LINE_CMT  = /^\/\/[^\r\n]*/;
const RE_DQ_STR    = /^(?:f"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*")/;
const RE_SQ_STR    = /^'(?:[^'\\]|\\.)*'/;
const RE_NUMBER    = /^(?:0x[0-9A-Fa-f]+|0b[01]+|0o[0-7]+|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?[fFlLuU]*)/;
const RE_IDENT     = /^[A-Za-z_][A-Za-z0-9_]*/;
const RE_PUNCT     = /^(?:<<=|>>=|\.\.\.|\|\||&&|==|!=|<=|>=|<<|>>|\+\+|--|->|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|~=|::|\.\.|[{}()\[\]<>.,;:!~+\-*/%&|^=?@#])/;

function lex(source) {
    const tokens = [];
    let pos = 0;
    while (pos < source.length) {
        const rest = source.slice(pos);
        let m;
        if      ((m = rest.match(RE_NEWLINE)))   tokens.push({ kind: TK.Newline,      text: m[0] });
        else if ((m = rest.match(RE_WS)))         tokens.push({ kind: TK.Whitespace,   text: m[0] });
        else if ((m = rest.match(RE_BLOCK_CMT)))  tokens.push({ kind: TK.BlockComment, text: m[0] });
        else if ((m = rest.match(RE_LINE_CMT)))   tokens.push({ kind: TK.LineComment,  text: m[0] });
        else if ((m = rest.match(RE_DQ_STR)))     tokens.push({ kind: TK.String,       text: m[0] });
        else if ((m = rest.match(RE_SQ_STR)))     tokens.push({ kind: TK.String,       text: m[0] });
        else if ((m = rest.match(RE_NUMBER)))     tokens.push({ kind: TK.Number,       text: m[0] });
        else if ((m = rest.match(RE_IDENT)))      tokens.push({ kind: TK.Identifier,   text: m[0] });
        else if ((m = rest.match(RE_PUNCT)))      tokens.push({ kind: TK.Punct,        text: m[0] });
        else { tokens.push({ kind: TK.Punct, text: rest[0] }); m = [rest[0]]; }
        pos += m[0].length;
    }
    tokens.push({ kind: TK.EOF, text: "" });
    return tokens;
}

// ---- Splitter ----
//
// Mirrors ParseScopeIntoStatements from as_parser.ts:
//   - ';' at paren-depth-0 ends a statement
//   - '{' at paren-depth-0 starts a scope block
//   - UPROPERTY/UFUNCTION/UCLASS/USTRUCT lines are treated as standalone
//     statements (they have no ';' but the next real line is a new statement)

const MACRO_KEYWORDS = new Set(["UPROPERTY","UFUNCTION","UCLASS","USTRUCT"]);
// Control-flow keywords whose closing ')' ends the header (body is next statement)
const CONTROL_FLOW_KEYWORDS = new Set(["if", "for", "while"]);

class Splitter {
    constructor(tokens) { this.tokens = tokens; this.idx = 0; }

    peek(off = 0) { return this.tokens[this.idx + off] || { kind: TK.EOF, text: "" }; }
    advance() { return this.tokens[this.idx++] || { kind: TK.EOF, text: "" }; }

    skipWS() {
        while (this.peek().kind === TK.Whitespace || this.peek().kind === TK.Newline) this.idx++;
    }
    skipHWS() {
        while (this.peek().kind === TK.Whitespace) this.idx++;
    }

    countBlankLines() {
        let newlines = 0, blanks = 0, i = this.idx;
        while (i < this.tokens.length) {
            const k = this.tokens[i].kind;
            if (k === TK.Newline) { newlines++; if (newlines > 1) blanks++; i++; }
            else if (k === TK.Whitespace) { i++; }
            else break;
        }
        return blanks;
    }

    split() { return this.readScope(); }

    readScope() {
        const units = [];
        while (true) {
            const blanks = this.countBlankLines();
            this.skipWS();
            const t = this.peek();
            if (t.kind === TK.EOF) break;
            if (t.kind === TK.Punct && t.text === "}") break;

            if (blanks > 0 && units.length > 0)
                units.push({ kind: "blank", tokens: [] });

            if (t.kind === TK.LineComment) {
                this.advance();
                units.push({ kind: "comment", tokens: [t] });
                continue;
            }
            if (t.kind === TK.BlockComment) {
                this.advance();
                units.push({ kind: "comment", tokens: [t] });
                continue;
            }
            if (t.kind === TK.Punct && t.text === "#") {
                units.push({ kind: "preproc", tokens: this.readUntilNewline() });
                continue;
            }
            units.push(this.readStatementOrScope());
        }
        return units;
    }

    readUntilNewline() {
        const toks = [];
        while (true) {
            const t = this.peek();
            if (t.kind === TK.EOF || t.kind === TK.Newline) break;
            this.advance();
            if (t.kind !== TK.Whitespace) toks.push(t);
        }
        return toks;
    }

    /**
     * Read one statement or one scope-block.
     *
     * UPROPERTY/UFUNCTION macros are split off as a standalone statement:
     * we read the macro name + its balanced '(...)' and stop there.
     * The variable/function declaration on the next physical line will be
     * picked up as a separate statement on the next call.
     */
    readStatementOrScope() {
        const codeToks = [];
        let trailingComment;
        let parenDepth = 0;
        // Track whether the first token is a control-flow keyword
        let controlFlowHeader = false;
        let controlFlowParenClosed = false;

        while (true) {
            const t = this.peek();
            if (t.kind === TK.EOF) break;

            if (t.kind === TK.Whitespace || t.kind === TK.Newline) { this.advance(); continue; }

            if (t.kind === TK.LineComment) {
                this.advance();
                trailingComment = t;
                break;
            }
            if (t.kind === TK.BlockComment) { this.advance(); continue; }

            // After a control-flow header's ')' closed, peek at the next real token.
            // If it's not '{', stop here — body is a separate statement.
            if (controlFlowParenClosed) {
                if (t.kind === TK.Punct && t.text === "{") {
                    // brace-enclosed body — let it fall through to the '{' handler below
                    controlFlowParenClosed = false;
                } else {
                    // braceless body — stop, body becomes next statement
                    break;
                }
            }

            if (t.kind === TK.Punct) {
                if (t.text === "(") parenDepth++;
                if (t.text === ")") {
                    parenDepth--;
                    // If this closes the condition of a control-flow keyword, mark it
                    if (parenDepth === 0 && controlFlowHeader) {
                        this.advance(); codeToks.push(t);
                        controlFlowParenClosed = true;
                        continue;
                    }
                }

                if (parenDepth === 0) {
                    if (t.text === ";") {
                        this.advance(); codeToks.push(t);
                        this.skipHWS();
                        if (this.peek().kind === TK.LineComment) trailingComment = this.advance();
                        break;
                    }
                    if (t.text === "{") {
                        this.advance();
                        const children = this.readScope();
                        if (this.peek().kind === TK.Punct && this.peek().text === "}") this.advance();
                        this.skipHWS();
                        let closingSemi = false;
                        if (this.peek().kind === TK.Punct && this.peek().text === ";") {
                            this.advance(); closingSemi = true;
                        }
                        return { kind: "scope", tokens: codeToks, trailingComment, children, closingSemi };
                    }
                    if (t.text === "}") break;
                }
            }

            // Detect control-flow keyword at the start of a statement
            if (codeToks.length === 0 && parenDepth === 0 &&
                t.kind === TK.Identifier && CONTROL_FLOW_KEYWORDS.has(t.text))
            {
                controlFlowHeader = true;
            }

            // MACRO keyword at paren-depth-0 and beginning of statement:
            // read name + '(...)' then stop — next line is a separate statement.
            if (parenDepth === 0 && codeToks.length === 0 &&
                t.kind === TK.Identifier && MACRO_KEYWORDS.has(t.text))
            {
                codeToks.push(this.advance()); // macro name
                this.skipWS();
                if (this.peek().kind === TK.Punct && this.peek().text === "(") {
                    codeToks.push(this.advance()); // '('
                    parenDepth = 1;
                    // read until matching ')'
                    while (parenDepth > 0) {
                        const mt = this.advance();
                        if (mt.kind === TK.EOF) break;
                        if (mt.kind === TK.Whitespace || mt.kind === TK.Newline) continue;
                        if (mt.kind === TK.Punct && mt.text === "(") parenDepth++;
                        if (mt.kind === TK.Punct && mt.text === ")") parenDepth--;
                        codeToks.push(mt);
                    }
                    parenDepth = 0;
                }
                // stop here — remaining content is next statement
                break;
            }

            this.advance();
            codeToks.push(t);
        }

        return { kind: "statement", tokens: codeToks, trailingComment };
    }
}

// ---- Emitter ----

const INDENT_UNIT = "\t";
const MAX_LINE = 100;

const KEYWORD_SPACE_BEFORE_PAREN = new Set(["if","else","for","while","switch","return","case"]);

const BINARY_OPS = new Set([
    "*","/","%","&","|","^",
    "==","!=","<=",">=","<<",">>","&&","||",
    "=","+=","-=","*=","/=","%=","&=","|=","^=","~=","<<=",">>=",
]);

class Emitter {
    constructor() { this.depth = 0; this.out = []; }

    emit(units) {
        this.emitUnits(units);
        return this.out.join("\r\n").trimEnd() + "\r\n";
    }

    emitUnits(units) {
        for (let i = 0; i < units.length; i++) {
            const u = units[i];

            if (u.kind === "blank") {
                if (i > 0 && i < units.length - 1) this.out.push("");
                continue;
            }
            if (u.kind === "comment") {
                const tok = u.tokens[0];
                if (!tok) continue;
                if (tok.kind === TK.LineComment)
                    this.out.push(this.indent() + tok.text.trimEnd());
                else
                    this.emitBlockComment(tok.text);
                continue;
            }
            if (u.kind === "preproc") {
                this.out.push(this.indent() + u.tokens.map(t => t.text).join(""));
                continue;
            }
            if (u.kind === "statement") {
                if (u.tokens.length === 0) continue;
                const baseCol = this.depth;  // tab depth
                const wrapIndent = this.depth + 1;
                const line = this.formatTokens(u.tokens, baseCol, wrapIndent);
                const trail = u.trailingComment ? "  " + u.trailingComment.text.trimEnd() : "";
                if (isControlFlowHeader(u.tokens) && i + 1 < units.length) {
                    const next = units[i + 1];
                    if (next && next.kind === "statement" && next.tokens.length > 0) {
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
            if (u.kind === "scope") {
                const baseCol = this.depth;
                const wrapIndent = this.depth + 1;
                const header = u.tokens.length > 0 ? this.formatTokens(u.tokens, baseCol, wrapIndent) : "";
                const trail = u.trailingComment ? "  " + u.trailingComment.text.trimEnd() : "";
                if (header) this.out.push(this.indent() + header + trail);
                this.out.push(this.indent() + "{");
                this.depth++;
                this.emitUnits(u.children || []);
                this.depth--;
                this.out.push(this.indent() + "}" + (u.closingSemi ? ";" : ""));
                continue;
            }
        }
    }

    indent() { return INDENT_UNIT.repeat(this.depth); }

    emitBlockComment(text) {
        const lines = text.split(/\r?\n/);
        const ind = this.indent();
        this.out.push(ind + lines[0]);
        for (let i = 1; i < lines.length; i++) {
            this.out.push(ind + " " + lines[i].replace(/^[ \t]*/, ""));
        }
    }

    formatTokens(tokens, baseCol, wrapIndent) {
        if (!tokens.length) return "";
        if (baseCol === undefined) baseCol = 0;
        if (wrapIndent === undefined) wrapIndent = baseCol + 1;

        let hasSemi = false;
        while (tokens.length && tokens[tokens.length-1].kind === TK.Punct && tokens[tokens.length-1].text === ";") {
            tokens = tokens.slice(0, -1);
            hasSemi = true;
        }

        // For line-length purposes, treat each tab as 4 columns
        const TAB_WIDTH = 4;
        let result = "";
        let last = "";
        let col = baseCol * TAB_WIDTH;
        let parenDepth = 0;
        let parenColStack = [];

        const app = (s) => {
            if (result.endsWith(" ") && s.startsWith(" ")) s = s.slice(1);
            result += s;
            const nl = s.lastIndexOf("\n");
            if (nl >= 0) col = s.length - nl - 1;
            else col += s.length;
            if (s.trim()) last = s.trim();
        };

        const nextArgLen = (startIdx) => {
            let len = 0, depth = 0;
            for (let j = startIdx; j < tokens.length; j++) {
                const tk = tokens[j];
                if (tk.kind === TK.Whitespace || tk.kind === TK.Newline) continue;
                if (tk.kind === TK.Punct) {
                    if (tk.text === "(" || tk.text === "[") { depth++; len += 1; continue; }
                    if (tk.text === ")" || tk.text === "]") {
                        if (depth === 0) break;
                        depth--; len += 1; continue;
                    }
                    if (tk.text === "," && depth === 0) break;
                }
                len += tk.text.length + 1;
            }
            return len;
        };

        const wrapStr = "\r\n" + "\t".repeat(wrapIndent);
        const wrapCol = wrapIndent * TAB_WIDTH;

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];

            if (t.kind === TK.Punct && t.text === "(") {
                parenDepth++;
                app(spacedPunct("(", last, tokens, i));
                parenColStack.push(col);
                if (col + nextArgLen(i + 1) > MAX_LINE) {
                    result += wrapStr;
                    col = wrapCol;
                }
                continue;
            }
            if (t.kind === TK.Punct && t.text === ")") {
                parenDepth--;
                parenColStack.pop();
                app(")");
                continue;
            }
            if (t.kind === TK.Punct && t.text === "," && parenDepth > 0) {
                if (col + 2 + nextArgLen(i + 1) > MAX_LINE) {
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

// ---- spacing helpers ----

/**
 * Should there be a space before an identifier or value?
 * "kind" = "ident" | "value"
 */
function spaceBefore(last, kind) {
    if (!last) return "";
    // no space after: ( [ < :: @ ~ ! -> .
    if (/^[(\[<~!@]$/.test(last) || last === "::" || last === "->" || last === ".") return "";
    // no space between unary +/- and the following number/identifier
    if (last === "-" || last === "+") return "";
    return " ";
}

/**
 * Determine the formatted representation of a punctuation token,
 * including any leading/trailing spaces.
 */
function spacedPunct(text, last, tokens, i) {
    switch (text) {
        // ---- grouping ----
        case "(":
            // space for control-flow keywords: if (, for (, while (, etc.
            // also space after 'return' when followed by '(' for cast expressions
            return (KEYWORD_SPACE_BEFORE_PAREN.has(last) || last === "return") ? " (" : "(";
        case ")": return ")";
        case "[": return (last && /[A-Za-z0-9_)\]]$/.test(last)) ? "[" : "[";
        case "]": return "]";

        // ---- punctuation ----
        case ",": return ", ";
        case ";": return ";";
        case ".": return ".";
        case "::": return "::";
        case ":":
            // class inheritance colon, ternary operator, case label, for-each colon
            // In all cases " : " looks right except inside template/type context.
            // Simple rule: space on both sides.
            return " :";        case "->": return "->";

        // ---- unary-only ----
        case "++": case "--": return text;
        case "~":
            return (last && /[A-Za-z0-9_)\]]$/.test(last)) ? " ~" : "~";
        case "!":
            return (last && /[A-Za-z0-9_)\]]$/.test(last)) ? " !" : "!";

        // ---- pointer / reference qualifiers vs binary ----
        case "*": case "&":
            // After identifier/number/closing bracket → binary or qualifier with space
            if (last && /[A-Za-z0-9_>\]]$/.test(last)) return " " + text;
            return text;

        // ---- comparisons / template angle brackets ----
        // '<' after identifier could be template, not comparison — no leading space in that case.
        // We use a simple heuristic: if prev is an identifier, it's likely a template.
        case "<": return (last && /[A-Za-z0-9_>\]]$/.test(last)) ? "<" : "<";
        case ">": return ">";

        // ---- +/- : binary vs unary heuristic ----
        case "+": case "-": {
            // "return -x" → the '-' is unary but needs a space: "return -x"
            if (last === "return") return " " + text;
            // Unary when prev is ( [ , or any operator/keyword (not an operand)
            const prevIsOperand = last && /[A-Za-z0-9_)\]"]$/.test(last);
            if (!prevIsOperand) return text;   // unary — no extra space
            return " " + text + " ";           // binary
        }

        // ---- all other binary operators ----
        default:
            if (BINARY_OPS.has(text)) return " " + text + " ";
            return text;
    }
}

// ---- control-flow header detection ----
// Returns true if the token list is a braceless control-flow statement
// (i.e. starts with if/for/while/else and has no '{' at paren-depth-0).
const CONTROL_FLOW_KW = new Set(["if", "for", "while", "else"]);
function isControlFlowHeader(tokens) {
    if (!tokens.length) return false;
    const first = tokens[0];
    if (first.kind !== TK.Identifier || !CONTROL_FLOW_KW.has(first.text)) return false;
    // Must not already end with ';' (that would be a complete statement)
    const last = tokens[tokens.length - 1];
    if (last.kind === TK.Punct && last.text === ";") return false;
    return true;
}

// ---- entry point ----
function formatASSource(source) {
    const tokens = lex(source);
    const units  = new Splitter(tokens).split();
    return new Emitter().emit(units);
}

const inputPath = process.argv[2] || "d:/MainDev/Main/Script/AI/AS_BTD_CheckAngleToEngagedActor.as";
const source = fs.readFileSync(inputPath, "utf-8");
process.stdout.write(formatASSource(source));
