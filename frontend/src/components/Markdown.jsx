import { useState, Children, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

function nodeText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText(node.props.children);
  return '';
}

export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { /* clipboard blocked */ }
      }}
      className={className}
      aria-label={label}
      title={label}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {className.includes('gap') && <span>{done ? 'Copied' : label}</span>}
    </button>
  );
}

function Pre({ children }) {
  const child = Children.toArray(children)[0];
  const lang = (isValidElement(child) && /language-([\w-]+)/.exec(child.props.className || ''))?.[1];
  const text = nodeText(children).replace(/\n$/, '');
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-slate-200 dark:border-ink-700 bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-1.5 bg-ink-800 text-slate-300 text-xs">
        <span className="font-mono">{lang || 'code'}</span>
        <CopyButton text={text} label="Copy code"
          className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-ink-600" />
      </div>
      <pre className="overflow-x-auto">{children}</pre>
    </div>
  );
}

const components = {
  pre: Pre,
  table: ({ children }) => <div className="my-4 overflow-x-auto"><table>{children}</table></div>,
  a: ({ children, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener">{children}</a>,
};

export default function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
