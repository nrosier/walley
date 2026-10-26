import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Every .tsx under src/web as raw text, keyed by path relative to src/web (Vite glob: src/web must not import Node built-ins). */
const modules = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
const sources = Object.entries(modules).map(([path, text]) => ({ path: path.replace(/^\.\.\//, ''), text }));

/** Attributes whose string value a user can see or hear. Everything else (className, id, key, type, role, data-*, htmlFor, name, value) is ignored. */
const VISIBLE_ATTRIBUTES = new Set([
  'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription',
  'aria-valuetext', 'title', 'alt', 'label', 'summary',
]);

/**
 * Allow-list of `relative/path.tsx:text` (path from src/web), one reason each. Empty: non-visible attributes,
 * `{expression}` values, icon-only SVG and the text-free files (main, I18nProvider, ui/badge, ui/button) never
 * produce a hit, so they need no entry. Keep it short; do not hide real strings here.
 */
const ALLOWED: Record<string, string> = {};

/** True when the text holds a word of two or more letters (symbols, digits and single glyphs are not English). */
const isWords = (text: string) => /\p{L}{2,}/u.test(text);

function findLiterals(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const where = `${file}:${String(line)}`;
    if (!(`${file}:${text.trim()}` in ALLOWED)) found.push(`${where}  ${JSON.stringify(text.trim())}`);
  };
  const literalText = (node: ts.Node | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isWords(node.text)) report(node, node.text);
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      const text = literalText(node.expression);
      if (text !== undefined && isWords(text)) report(node, text);
    }
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(source))) {
      const init = node.initializer;
      const text = literalText(init) ?? (init && ts.isJsxExpression(init) ? literalText(init.expression) : undefined);
      if (text !== undefined && isWords(text)) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('no hard-coded JSX text', () => {
  it('scans the web sources', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('finds no hard-coded English text or visible attribute in non-test .tsx files', () => {
    expect(sources.flatMap(({ path, text }) => findLiterals(path, text))).toEqual([]);
  });

  it('detects literals in a sample (scanner self-check)', () => {
    const sample = `const a = <button title="Save it" className="btn" aria-label={t('x')} placeholder='Name'>Save {n} <b>{'Cancel'}</b><i>×</i></button>;`;
    const hits = findLiterals('sample.tsx', sample).map((hit) => hit.split('  ')[1]);
    expect(hits).toEqual(['"Save it"', '"Name"', '"Save"', '"Cancel"']);
  });
});
