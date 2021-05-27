import { inspect } from 'util';
import path from 'path';
import { assert } from 'chai';
import { createNamespace } from 'cls-hooked';
import { v4 as uuid } from 'uuid';
import fs from 'fs-extra';
import { parseModule } from 'esprima';
import escodegen from 'escodegen';
import myrmidon from 'tests/entry';
import { saveExamles, entry } from './constants';


const context = createNamespace('test');
const EXAMPLES = [];
const PRINT_CASES = [];

async function loadFromFile(testFilePath, title) {
    const testFileContent = await fs.readFile(testFilePath);
    const rootAst = parseModule(testFileContent.toString());
    const currentExpression = rootAst.body.find(item => {
        if (item.type !== 'ExpressionStatement') return false;
        const callerName = item.expression.callee.name || item.expression.callee.object?.name;

        if (callerName !== 'test') return false;

        return item.expression.arguments.some(arg => arg.value === title);
    });

    return currentExpression.expression.arguments[1];
}

function loadFromBody(fn, title, err) {
    const titleAlias = title.replace(/\W+/g, '_');

    console.error(titleAlias, err);

    return parseModule(fn.toString().replace('function ()', `function ${titleAlias}()`)).body[0];
}

if (saveExamles) {
    beforeEach(async function setClsFromContext() {
        const old = this.currentTest.fn;
        const ast = await loadFromFile(this.currentTest.file, this.currentTest.title)
            .catch((error) => loadFromBody(old, this.currentTest.title, error));

        this.currentTest._TRACE_ID = uuid();
        this.currentTest.fn = function clsWrapper() {
            return new Promise((res, rej) => {
                context.run(() => {
                    context.set('current', {
                        test  : this.test.title,
                        suite : this.test.parent.title,
                        body  : ast,
                        id    : this.test._TRACE_ID
                    });

                    // eslint-disable-next-line promise/prefer-await-to-then
                    Promise.resolve(Reflect.apply(old, this, arguments)).then(res).catch(rej);
                });
            });
        };
    });

    afterEach(async function writeExamples() {
        const examples = EXAMPLES.filter(e => e.test === this.currentTest._TRACE_ID);

        if (examples.length > 0) {
            PRINT_CASES.push({
                testID : this.currentTest._TRACE_ID,
                test   : this.currentTest.title,
                suite  : this.currentTest.parent.title,
                examples
            });
            await fs.writeFile(saveExamles, JSON.stringify(PRINT_CASES));
        }
    });
}

export class FunctionTester {
    constructor(func) {
        this.func = func;
    }

    test(...args) {
        const [ output, ...revinput ] = args.reverse();
        const input = revinput.reverse();
        const got = this.func(...input);
        const errMessage = `${input.join(',')} => ${output}`;

        if (output) {
            assert.deepEqual(got, output, errMessage);
        }

        if (saveExamles) {
            const exapleIndex = EXAMPLES.filter(e => e.test === context.get('current').id).length;

            const ast = context.get('current').body;
            const statements = ast.body.body.filter(a => a.type === 'ExpressionStatement' && a.expression.callee.property.name === 'test');
            const snippet = statements[exapleIndex];
            const exampleArguments = snippet.expression.arguments;
            const inputArguments = exampleArguments.slice(0, -1);
            const rawInputArguments = inputArguments
                .map(literal => escodegen.generate(literal, { format: { compact: true } }));

            EXAMPLES.push({
                type     : 'FunctionTester',
                function : this.func.name,
                output   : inspect(output),
                input    : rawInputArguments,
                test     : context.get('current').id
            });
        }
    }
}

const inspectOpts = {
    breakLength    : Number.POSITIVE_INFINITY,
    depth          : 4,
    maxArrayLength : 10,
    compact        : true
};

export async function SnippetTesterAsync(func, expected) {
    try {
        const result = await func(myrmidon);

        if (expected) {
            assert.deepEqual(result, expected);
        }

        if (saveExamles) {
            const ast = context.get('current').body;
            const exapleIndex = EXAMPLES.filter(e => e.test === context.get('current').id).length;
            const statements = ast.body.body.filter(a => a.type === 'ExpressionStatement');
            const testerFunc = statements[exapleIndex];
            const snippetInput = testerFunc.expression.argument.arguments[0].params;
            const helpers = snippetInput[0].properties.map(p => p.key.name);

            const inline = escodegen.generate(
                testerFunc.expression.argument.arguments[0].body,
                { format: { compact: true } }
            );
            const needAsync = inline.includes('await');
            const prefix = needAsync ? 'async' : '';
            const body = `${prefix} () =>${inline}`;

            EXAMPLES.push({
                type      : 'SnippetTester',
                functions : helpers,
                output    : inspect(result, inspectOpts),
                input     : body,
                test      : context.get('current').id
            });
        }
    } catch (error) {
        if (error.name !== 'AssertionError' && expected && expected instanceof Error) {
            assert.equal(error.message, expected.message);
            // TODO: save examples
        } else {
            throw error;
        }
    }
}


export const sleep = time => new Promise(res => setTimeout(res, time));

export function load(relPath, clearCache) {
    const absPath = path.resolve(entry, relPath);

    if (clearCache) delete require.cache[require.resolve(absPath)];
    // eslint-disable-next-line security/detect-non-literal-require
    const result =  require(absPath);

    if (clearCache) delete require.cache[require.resolve(absPath)];

    return result;
}

export function resolve(relPath) {
    return require.resolve(path.join(entry, relPath));
}
