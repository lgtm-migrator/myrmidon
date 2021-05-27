import path from 'path';
import documentation from 'documentation';
import mdinclude from 'mdinclude';
import handleBars from 'handlebars';
import fs from 'fs-extra';
import { CLIEngine } from 'eslint';
import recommended from 'remark-preset-lint-recommended';
import remark from 'remark';
import toc from 'remark-toc';
import { groupBy, uniqueIdenticFilter, flatten } from '../src/helpers';
import info from '../package';

handleBars.registerHelper('join', (items = [], sep = ' ') => {
    return items.join(sep);
});

handleBars.registerHelper('lowercase', str => {
    return str.toLowerCase();
});

handleBars.registerHelper('is', function (value, test, options) {
    if (value && value === test) {
        return options.fn(this);
    }

    return options.inverse(this);
});

handleBars.registerHelper('any', function (array, options) {
    if (array && array.length > 0) {
        return options.fn(this);
    }

    return options.inverse(this);
});

const eslint = new CLIEngine({
    fix : true
});

const examplesPath = path.join(process.cwd(), 'tmp', 'examples.json');

const SECTIONS = {
    checkType : 'helps to indicate type of any value',
    array     : 'helps to work with js arrays',
    benchmark : 'helps to benchmark execution time'
};
const gitHeadPrefixLen = 5;
const getGitCommit = async () => {
    const gitId = await fs.readFile('.git/HEAD', 'utf8');

    if (!gitId.includes(':')) {
        return gitId.trim();
    }

    const refPath = `.git/${gitId.slice(Math.max(0, gitHeadPrefixLen)).trim()}`;
    const content = await fs.readFile(refPath, 'utf8');

    return content.trim();
};

async function prepareExamples() {
    const examples = await fs.readJSON(examplesPath);
    const template = getTemplate('templates/documentation/examples.handlebars');

    return examples
        .map((element) => dumpTest(element))
        .map(data => {
            const raw = template({ ...data, info });
            const code =  eslint.executeOnText(raw).results[0].output;

            return { ...data, code };
        });
}

async function getFiles(dir) {
    const subdirs = await fs.readdir(dir);
    const files = await Promise.all(subdirs.map(async (subdir) => {
        const res = path.resolve(dir, subdir);

        return (await fs.stat(res)).isDirectory() ? getFiles(res) : res;
    }));

    return files.flat();
}

export async function buildDocs(folder = 'docs') {
    return Promise.all([
        await build('templates/documentation/reference.md', path.join(folder, 'reference.md')),
        await build('templates/documentation/docs.md', path.join(folder, 'index.md'))
    ]);
}

export async function buildReadme(out) {
    return Promise.all([
        await build('templates/documentation/readme.md', out ? path.join(out, 'README.md') : 'README.md')
    ]);
}

function getTemplate(entry) {
    const readmeTemplateText = mdinclude.readFileSync(entry); // eslint-disable-line no-sync

    return handleBars.compile(readmeTemplateText, { noEscape: true });
}

export async function build(entry, out) {
    const rawData = await documentation.build([ 'src/index.js' ], {});
    const cases = await prepareExamples();
    const tests = await getFiles('tests');
    const relativeTestFiles = tests.map(f => path.relative(process.cwd(), f).trim());
    const docs = rawData.map((element) => dumpDoc(element));

    const sections = Object.entries(groupBy(docs, 'file'))
        .map(([ key, val ]) => {
            const fileName = path.basename(key, path.extname(key));
            const description = SECTIONS[fileName];

            return {
                file   : key,
                id     : fileName,
                description,
                values : val.map(v => {
                    const examples = cases
                        .filter(c => c.helpers.includes(v.name));
                    const testFile = relativeTestFiles
                        .find(f => f === path.join('tests', 'helpers', fileName, `${v.name}.test.js`));

                    return {
                        ...v,
                        testFile,
                        examples
                    };
                })
            };
        });
    const readmeTemplate = getTemplate(entry);
    const commit = await getGitCommit();
    const readme =  readmeTemplate({
        info,
        sections,
        commit
    });
    const outPath = path.resolve(out);

    await fs.ensureDir(path.dirname(outPath));

    await new Promise((res, rej) => {
        remark()
            .use(toc)
            .use(recommended)
            .process(readme, async (err, file) => {
                if (err) rej(err);
                await fs.writeFile(outPath, String(file));
                console.log('done build', outPath);
                res();
            });
    });
}

function dumpDescription(d) {
    return d ? d.children[0].children[0].value : '';
}

function dumpParam(p) {
    if (!p.type) return null;

    return {
        name        : p.name,
        type        : p.type.name,
        description : dumpDescription(p.description)
    };
}

function dumpDoc(d) {
    return {
        name        : d.name,
        type        : d.kind,
        comment     : d.comment,
        description : dumpDescription(d.description),

        params  : d.params.map((element) => dumpParam(element)),
        returns : d.returns[0] && dumpParam(d.returns[0]),

        file     : path.relative(process.cwd(), d.context.file).trim(),
        position : d.loc.start.line
    };
}

function dumpTest(useCase) {
    const [ caseType, caseText ] = useCase.test.split(':');
    const helperNames = useCase.examples.map(example =>
        example.type === 'FunctionTester' && example.function
        || example.type === 'SnippetTester' && example.functions);
    const helpers = flatten(helperNames).filter((element, index, array) => uniqueIdenticFilter(element, index, array));

    return {
        helpers,
        type     : caseType.toLowerCase(),
        text     : caseText.replace(/@\w+/g, ''),
        category : caseText.suite,
        examples : useCase.examples
    };
}
