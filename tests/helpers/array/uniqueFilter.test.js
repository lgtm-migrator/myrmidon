import { SnippetTesterAsync } from 'tests/utils';

suite('Arrays: uniqueFilter');

test('Positive: uniqueFilter with strict equality function @example', async () => {
    await SnippetTesterAsync(({ uniqueFilter }) => {
        const leaveUnique = uniqueFilter((a, b) => a === b);

        return [ 1, 2, 3, 3, 2, 5 ].filter(leaveUnique);
    }, [ 1, 2, 3, 5 ]);
});
