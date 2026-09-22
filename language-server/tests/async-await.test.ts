import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as db from '../src/database';
import * as parser from '../src/as_parser';
import * as completion from '../src/parsed_completion';
import * as symbols from '../src/symbols';
import * as highlighting from '../src/semantic_highlighting';
import * as hints from '../src/inlay_hints';
const peg = require('../pegjs/angelscript.js');
const n = parser.node_types;

// Only native API metadata is stubbed; all language feature implementations are real.
const method = (name: string, returnType: string, args: [string, string][]) => ({
    name, return: returnType, isProperty: false, args: args.map(([name, type]) => ({ name, type })),
});
db.AddTypesFromUnreal({
    UObject: {}, FString: { isStruct: true }, FName: { isStruct: true }, FTask: { isStruct: true },
    UPLAutomationAction: { inherits: 'UObject' },
    UPLAutomationAsyncCaseBase_AS: { inherits: 'UObject' },
    UPLAutomationAsyncContext: {
        inherits: 'UObject', methods: {
            SetConsoleVariable: method('SetConsoleVariable', 'void', [['Name', 'FString'], ['Value', 'int']]),
            Defer: method('Defer', 'void', [['Cleanup', 'FName']]),
        },
    },
    __TestSteps: { methods: {
        WaitUntil: method('WaitUntil', 'UPLAutomationAction', [['Timeout', 'float'], ['Predicate', 'FName'], ['Description', 'FString']]),
        WaitSeconds: method('WaitSeconds', 'UPLAutomationAction', [['Seconds', 'float']]),
    } },
    __UISteps: { methods: {
        WaitForWidgetActive: method('WaitForWidgetActive', 'UPLAutomationAction', [['Widget', 'FString'], ['Timeout', 'float']]),
        ClickChildAt: method('ClickChildAt', 'UPLAutomationAction', [['Widget', 'FString'], ['Container', 'FString'], ['Index', 'int'], ['Timeout', 'float']]),
    } },
});
db.FinishTypesFromUnreal();
db.AddPrimitiveTypes(false);
let serial = 0;
function load(content: string) {
    const name = `AsyncRegression${serial++}`;
    const filename = path.join(__dirname, `${name}.as`);
    const module = parser.GetOrCreateModule(name, filename, pathToFileURL(filename).href);
    parser.UpdateModuleFromContent(module, content);
    parser.ParseModule(module);
    parser.PostProcessModuleTypes(module);
    parser.ResolveModule(module);
    return module;
}
function at(module: parser.ASModule, prefix: string) {
    const index = module.content.indexOf(prefix);
    assert.notEqual(index, -1, prefix);
    return module.getPosition(index + prefix.length);
}
function noParseErrors(module: parser.ASModule) {
    assert.deepEqual(module.rawStatements.filter(s => s.parseError).map(s => s.content), []);
}

const grammarCases = [
    ['start_global', 'class UExample : UObject', n.ClassDefinition],
    ['start_global', 'asset Curve of UCurveFloat', n.AssetDefinition],
    ['start_class', 'UPROPERTY(SaveGame) int Score', n.VariableDecl],
    ['start_class', 'default Score = 1', n.DefaultStatement],
    ['start', 'Actor.', n.MemberAccess],
    ['start', 'Math::', n.NamespaceAccess],
    ['start', 'return Value', n.ReturnStatement],
    ['start_enum', 'First, Second = 2', n.EnumValueList],
    ['start_class', 'private async FTask RunAsync(UPLAutomationAsyncContext T)', n.FunctionDecl],
    ['start_global', 'async FTask RunAsync()', n.FunctionDecl],
    ['start_global', 'local async FTask RunAsync()', n.FunctionDecl],
    ['start', 'await UISteps::', n.AwaitExpression],
    ['start', 'await T.', n.AwaitExpression],
    ['start', 'int async = 1', n.VariableDecl],
    ['start', 'int await = 2', n.VariableDecl],
    ['start', 'await = 2', n.Assignment],
    ['start', 'await++', n.PostfixOperation],
    ['start', 'await(1)', n.FunctionCall],
    ['start', 'async(1)', n.FunctionCall],
    ['start', 'awaitValue', n.Identifier],
    ['start_class', 'async Run()', n.FunctionDecl], // A type named async, not a modifier.
];
for (const [startRule, source, type] of grammarCases)
    assert.equal(peg.parse(source, { startRule }).type, type, source as string);
assert.equal(peg.parse('async Run()', { startRule: 'start_class' }).isAsync, undefined);
assert.equal(peg.parse('await', { inAsyncFunction: true }).type, n.AwaitExpression);
assert.equal(peg.parse('await(Child())', { inAsyncFunction: true }).type, n.AwaitExpression);
assert.equal(peg.parse('await').type, n.Identifier);

const source = fs.readFileSync(path.join(__dirname, 'fixtures/async-await.as'), 'utf8');
const module = load(source);
noParseErrors(module);
const type = db.GetTypeByName('UOptionUITestCase');
const run = type.findFirstSymbol('RunAsync', db.DBAllowSymbol.Functions) as db.DBMethod;
assert.equal(run.isAsync, true);
assert.equal(run.returnType, 'FTask');
assert.equal(run.args[0].typename, 'UPLAutomationAsyncContext');
assert.equal(run.format(), 'async FTask RunAsync(UPLAutomationAsyncContext T)');
const outline = symbols.DocumentSymbols(module).find(s => s.name === 'UOptionUITestCase');
const runSymbol = outline.children.find(s => s.name === 'RunAsync(…)');
assert.ok(runSymbol, 'RunAsync must be in the outline/breadcrumbs');
const runOffset = module.getOffset(runSymbol.selectionRange.start);
assert.equal(source.slice(runOffset, module.getOffset(runSymbol.selectionRange.end)), 'RunAsync');
assert.ok(module.getOffset(runSymbol.range.end) > source.indexOf('await ChildAsync();'));
assert.match(JSON.stringify(symbols.GetHover(module, at(module, 'async FTask RunA'))), /async FTask/);
assert.match(JSON.stringify(symbols.GetHover(module, at(module, 'await UISteps::WaitForWidgetAct'))), /UPLAutomationAction/);
assert.ok(symbols.GetDefinition(module, at(module, 'await ChildAs')).some(location =>
    module.getOffset(location.range.start) === source.indexOf('ChildAsync()\n    {')));
const awaitStatement = module.rawStatements.find(s => s.ast?.type === n.AwaitExpression);
assert.equal(parser.ResolveTypeFromExpression(module.getScopeAt(awaitStatement.start_offset + 1), awaitStatement.ast), null,
    'void-result await must not inherit the Action/FTask operand type');
assert.equal(module.semanticSymbols.filter(s => s.type === parser.ASSymbolType.UnknownError).length, 0);
for (const [word, kind] of [
    ['RunAsync', parser.ASSymbolType.MemberFunction],
    ['WaitUntil', parser.ASSymbolType.GlobalFunction],
    ['WaitForWidgetActive', parser.ASSymbolType.GlobalFunction],
    ['T', parser.ASSymbolType.Parameter],
    ['i', parser.ASSymbolType.LocalVariable],
] as const) {
    assert.ok(module.semanticSymbols.some(s => s.type === kind && source.slice(s.start, s.end) === word), word);
}
const tokens = highlighting.HighlightSymbols(module).data;
assert.ok(tokens.length > 0);
let line = 0, character = 0;
const colored = [];
for (let i = 0; i < tokens.length; i += 5) {
    character = tokens[i] ? tokens[i + 1] : character + tokens[i + 1];
    line += tokens[i];
    const offset = module.getOffset({ line, character });
    colored.push([source.slice(offset, offset + tokens[i + 2]), highlighting.SemanticTypeList[tokens[i + 3]]]);
}
assert.ok(colored.some(([word, kind]) => word === 'RunAsync' && kind === 'member_function'));
assert.ok(colored.some(([word, kind]) => word === 'WaitUntil' && kind === 'global_function'));
const inlays = hints.GetInlayHintsForRange(module, module.getRange(0, source.length));
const timeoutPosition = at(module, 'await UISteps::WaitForWidgetActive("WBP_Layout_Game_C_0", ');
assert.ok(inlays.some(h => h.position.line === timeoutPosition.line && h.position.character === timeoutPosition.character),
    'await call arguments must retain parameter inlay hints');
const sig = completion.Signature(module, at(module, 'await UISteps::WaitForWidgetActive("WBP_Layout_Game_C_0", '));
assert.match(sig.signatures[0].label, /float Timeout/);
assert.equal(sig.activeParameter, 1);
assert.ok(completion.Complete(module, at(module, 'T.')).some(c => c.label === 'SetConsoleVariable'));
assert.ok(completion.Complete(module, at(module, 'this.')).some(c => c.label === 'BeginUIFixture'));
console.log('PASS: real async fixture parse, scope, outline, hover, definition, semantic tokens, signature and inlay hints');

function editing(code: string, async = true) {
    const text = `class UEditing${serial} { ${async ? 'async FTask' : 'void'} Run(UPLAutomationAsyncContext T) { ${code}\n } }`;
    const offset = text.indexOf('|');
    const edited = load(text.replace('|', ''));
    return { module: edited, position: edited.getPosition(offset), items: completion.Complete(edited, edited.getPosition(offset)) || [] };
}
for (const [code, expected] of [
    ['await UISteps::|', 'WaitForWidgetActive'],
    ['await UISteps::WaitFor|', 'WaitForWidgetActive'],
    ['await TestSteps::|', 'WaitUntil'],
    ['await T.|', 'SetConsoleVariable'],
    ['await |', 'UISteps'],
    ['awa|', 'await'],
    ['T.|', 'SetConsoleVariable'],
]) {
    const result = editing(code);
    assert.ok(result.items.some(c => c.label === expected), `${code}: expected ${expected}, got ${result.items.map(c => c.label)}`);
}
const incompleteCall = editing('await UISteps::WaitForWidgetActive("Menu", |');
assert.match(completion.Signature(incompleteCall.module, incompleteCall.position).signatures[0].label, /float Timeout/);
const sync = editing('awa|', false);
assert.ok(!sync.items.some(c => c.label === 'await'), 'do not suggest await in ordinary functions');
const global = load('asy');
assert.ok(completion.Complete(global, at(global, 'asy')).some(c => c.label === 'async'));
const classDecl = load('class UDecl { asy }');
assert.ok(completion.Complete(classDecl, at(classDecl, 'asy')).some(c => c.label === 'async'));

// Changing only the async modifier must invalidate cached body parsing.
const incremental = load('FTask Cache() { await(Child()); }');
assert.equal(incremental.rawStatements.find(s => s.content.includes('await')).ast.type, n.FunctionCall);
for (const modifier of ['async ', '']) {
    parser.UpdateModuleFromContent(incremental, `${modifier}FTask Cache() { await(Child()); }`);
    parser.ParseModule(incremental);
    noParseErrors(incremental);
    assert.equal(incremental.rawStatements.find(s => s.content.includes('await')).ast.type,
        modifier ? n.AwaitExpression : n.FunctionCall);
}
const crlf = load(source.replaceAll('\n', '\r\n').replaceAll('UOptionUITestCase', 'UCRLFCase'));
noParseErrors(crlf);
assert.ok(symbols.DocumentSymbols(crlf).find(s => s.name === 'UCRLFCase').children.some(s => s.name === 'RunAsync(…)'));
console.log(`PASS: ${grammarCases.length} grammar cases, partial-input completions/signature, contextual identifiers, cache invalidation and CRLF`);
