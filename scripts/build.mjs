import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectDirectory, 'dist');
const deliverablesDirectory = resolve(projectDirectory, '..', 'deliverables');
const styleFiles = ['styles.css', 'market.css'];
const scriptFiles = ['demo-engine.js', 'map-data.js', 'market-engine.js', 'app.js', 'market-ui.js'];
const sourceFiles = ['index.html', ...styleFiles, ...scriptFiles, '.nojekyll', 'MAP-SOURCE.md'];
const sources = Object.fromEntries(await Promise.all(
  ['index.html', ...styleFiles, ...scriptFiles].map(async (filename) => [
    filename, await readFile(resolve(projectDirectory, filename), 'utf8'),
  ]),
));

function replaceExactOnce(document, tag, content) {
  const first = document.indexOf(tag);
  if (first === -1 || document.indexOf(tag, first + tag.length) !== -1) {
    throw new Error(`Expected exactly one source tag: ${tag}`);
  }
  return document.replace(tag, () => content);
}

// A closing tag in a JS/CSS string must not terminate the HTML element.
const inlineScript = (source) => source.replace(/<\/script/gi, '<\\/script');
const inlineStyle = (source) => source.replace(/<\/style/gi, '<\\/style');

let standaloneHtml = sources['index.html'];
for (const filename of styleFiles) {
  standaloneHtml = replaceExactOnce(
    standaloneHtml,
    `<link rel="stylesheet" href="./${filename}">`,
    `<style>\n${inlineStyle(sources[filename])}\n</style>`,
  );
}
for (const filename of scriptFiles) {
  standaloneHtml = replaceExactOnce(
    standaloneHtml,
    `<script src="./${filename}"></script>`,
    `<script>\n${inlineScript(sources[filename])}\n</script>`,
  );
}

await mkdir(distDirectory, { recursive: true });
await mkdir(deliverablesDirectory, { recursive: true });
await Promise.all(
  sourceFiles.map((filename) =>
    copyFile(resolve(projectDirectory, filename), resolve(distDirectory, filename)),
  ),
);
const standalonePath = resolve(deliverablesDirectory, 'recipe-recommender-prototype.html');
await writeFile(standalonePath, standaloneHtml, 'utf8');

console.log(`Static site: ${distDirectory}`);
console.log(`Standalone preview: ${standalonePath}`);
