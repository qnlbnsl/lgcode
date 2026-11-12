// The parts of CodeMirror 6 that the LGTM Studio web mock's Files tab uses.
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from '@codemirror/view';
export { EditorState, Compartment } from '@codemirror/state';
export { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
export { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { tags } from '@lezer/highlight';
export { javascript } from '@codemirror/lang-javascript';
export { markdown } from '@codemirror/lang-markdown';
export { css } from '@codemirror/lang-css';
export { json } from '@codemirror/lang-json';
export { yaml } from '@codemirror/lang-yaml';
