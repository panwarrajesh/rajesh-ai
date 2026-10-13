// Keep in sync with ai-service/extract.py
export const ACCEPT = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.pdf', '.docx',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.conf', '.log', '.html', '.htm', '.css', '.scss', '.svg', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue',
  '.svelte', '.py', '.ipynb', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh',
  '.bash', '.sql', '.swift', '.kt', '.dart', '.lua', '.r',
].join(',');

export const MAX_FILES = 8;

export const formatSize = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
