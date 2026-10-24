import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectDirectory, 'dist');
const deliverablesDirectory = resolve(projectDirectory, '..', 'deliverables');
const sourceFiles = ['index.html', 'styles.css', 'demo-engine.js', 'app.js', '.nojekyll'];

const [html, css, engine, app] = await Promise.all(
  sourceFiles.slice(0, 4).map((filename) => readFile(resolve(projectDirectory, filename), 'utf8')),
);

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

let standaloneHtml = replaceExactOnce(
  html,
  '<link rel="stylesheet" href="./styles.css">',
  `<style>\n${inlineStyle(css)}\n</style>`,
);
standaloneHtml = replaceExactOnce(
  standaloneHtml,
  '<script src="./demo-engine.js"></script>',
  `<script>\n${inlineScript(engine)}\n</script>`,
);
standaloneHtml = replaceExactOnce(
  standaloneHtml,
  '<script src="./app.js"></script>',
  `<script>\n${inlineScript(app)}\n</script>`,
);

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
