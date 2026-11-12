// The Files tab's editor. It is CodeMirror 6, from third_party/codemirror (MIT License),
// loaded as one bundle because the mock has no build step. Colours come from the mock's
// tokens, so the editor follows the light and dark modes without a theme of its own.
import { html, useRef, useEffect } from './lib.js';
import {
  EditorView, EditorState, Compartment, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, history, defaultKeymap, historyKeymap, indentWithTab,
  syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, searchKeymap, highlightSelectionMatches,
  tags as t, javascript, markdown, css, json, yaml,
} from '../vendor/codemirror/codemirror.bundle.js';

const colours = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], color: 'var(--color-info)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.monospace], color: 'var(--color-success)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--color-faint)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--color-warn)' },
  { tag: [t.typeName, t.className, t.tagName, t.angleBracket, t.namespace], color: 'var(--color-accent)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--color-text)' },
  { tag: t.heading, color: 'var(--color-info)', fontWeight: 'var(--weight-strong)' },
  { tag: t.strong, fontWeight: 'var(--weight-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--color-accent)', textDecoration: 'underline' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--color-faint)' },
  { tag: t.invalid, color: 'var(--color-error)' },
]);

const look = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--text-sm)', color: 'var(--color-text)', backgroundColor: 'var(--color-bg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', fontVariantLigatures: 'none' },
  '.cm-content': { padding: '8px 0 var(--space-6)', caretColor: 'var(--color-text)' },
  '.cm-line': { paddingRight: 'var(--space-6)' },
  '.cm-gutters': { backgroundColor: 'var(--color-bg)', color: 'var(--color-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 12px 0 8px' },
  '.cm-activeLine': { backgroundColor: 'var(--color-raised)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-raised)', color: 'var(--color-muted)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--color-selected)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-info-soft)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--color-info-soft)', outline: '1px solid var(--color-line-strong)' },
  '.cm-panels': { backgroundColor: 'var(--color-sidebar)', color: 'var(--color-text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--color-line)' },
  '.cm-searchMatch': { backgroundColor: 'var(--color-warn-soft)', outline: '1px solid var(--color-warn-line)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--color-info-soft)' },
  '.cm-textfield': { font: 'inherit', fontSize: 'var(--text-sm)', border: '1px solid var(--color-line-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)', padding: '2px 6px' },
  '.cm-button': { font: 'inherit', fontSize: 'var(--text-sm)', backgroundImage: 'none', background: 'var(--color-raised)', border: '1px solid var(--color-line)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' },
});

// The language, chosen by the file's extension. Other files are plain text.
function languageFor(path) {
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) return javascript({ typescript: true, jsx: ext === 'tsx' });
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return javascript({ jsx: ext === 'jsx' });
  if (ext === 'md' || ext === 'mdx') return markdown();
  if (ext === 'css') return css();
  if (ext === 'json') return json();
  if (ext === 'yaml' || ext === 'yml') return yaml();
  return [];
}

// One editor for one file. The parent gives it a `key` for each file, so opening another
// file starts a fresh editor with its own undo history.
export function CodeEditor({ doc, path, readOnly = false, wrap = false, onChange, onSave }) {
  const host = useRef(null); const view = useRef(null);
  const calls = useRef({}); calls.current = { onChange, onSave };
  const parts = useRef(null); if (!parts.current) parts.current = { lock: new Compartment(), wrap: new Compartment() };
  const lockOf = (ro) => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
  useEffect(() => {
    const p = parts.current;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
          indentOnInput(), bracketMatching(), highlightActiveLine(), highlightSelectionMatches(),
          syntaxHighlighting(colours), look, languageFor(path),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { calls.current.onSave?.(); return true; } },
            ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          p.lock.of(lockOf(readOnly)), p.wrap.of(wrap ? EditorView.lineWrapping : []),
          EditorView.contentAttributes.of({ 'aria-label': 'Contents of ' + path }),
          EditorView.updateListener.of((u) => { if (u.docChanged) calls.current.onChange?.(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: parts.current.lock.reconfigure(lockOf(readOnly)) }); }, [readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: parts.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  return html`<div class="fx-editor" ref=${host}></div>`;
}
