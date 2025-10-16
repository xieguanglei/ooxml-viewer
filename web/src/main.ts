import './style.css';

type WasmModule = {
  default: () => Promise<void>;
  init: () => void;
  inspect_ooxml: (bytes: Uint8Array) => ArchiveSummary;
};

type ArchiveSummary = {
  entries: ArchiveEntry[];
};

type ArchiveEntry = {
  path: string;
  is_dir: boolean;
  size: number;
  content: string | null;
};

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  content: string | null;
  children: TreeNode[];
};

type SelectHandler = (node: TreeNode, button: HTMLButtonElement) => void;

type LineType = 'open' | 'close' | 'self' | 'text' | 'comment' | 'declaration';

type HighlightedLine = {
  level: number;
  type: LineType;
  contentHtml: string;
  matchIndex?: number;
};

type ParsedAttribute = {
  name: string;
  value: string | null;
  quote: '"' | "'" | '';
};

const statusEl = document.getElementById('status') as HTMLSpanElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const tocEl = document.getElementById('toc') as HTMLElement;
const viewerTitle = document.getElementById('selected-path') as HTMLElement;
const viewerContent = document.getElementById('file-content') as HTMLElement;

let wasm: WasmModule | null = null;
let activeButton: HTMLButtonElement | null = null;

async function bootstrap() {
  try {
    const module = (await import('../pkg/wasm_core.js')) as WasmModule;
    await module.default();
    module.init();
    wasm = module;
    setStatus('Ready. Upload a .docx, .pptx, or .xlsx file.', 'success');
    fileInput.disabled = false;
  } catch (error) {
    console.error('Failed to initialise wasm', error);
    setStatus('Failed to load wasm module. Refresh the page to retry.', 'error');
    return;
  }

  fileInput.addEventListener('change', handleFileSelection);
}

async function handleFileSelection() {
  if (!wasm) {
    setStatus('Wasm runtime unavailable.', 'error');
    return;
  }

  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  resetViewer();
  setStatus(`Reading ${file.name}…`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const summary = wasm.inspect_ooxml(bytes);

    renderArchive(summary, file.name);
  } catch (error) {
    console.error('Processing failed', error);
    setStatus('Failed to read archive. Ensure the file is a valid .docx, .pptx, or .xlsx.', 'error');
  }
}

function renderArchive(summary: ArchiveSummary, fileName: string) {
  const entries = summary.entries ?? [];

  if (!entries.length) {
    tocEl.innerHTML = '<p class="placeholder">Archive contains no entries.</p>';
    setStatus(`Processed ${fileName}, no entries found.`, 'success');
    return;
  }

  const tree = buildTree(entries);
  renderTree(tocEl, tree, handleSelection);
  setStatus(`Loaded ${entries.length} parts from ${fileName}.`, 'success');
}

function handleSelection(node: TreeNode, button: HTMLButtonElement) {
  if (!node.isDir) {
    if (activeButton) {
      activeButton.classList.remove('is-active');
    }
    activeButton = button;
    activeButton.classList.add('is-active');

    viewerTitle.textContent = node.path;
    viewerContent.scrollTop = 0;
    viewerContent.scrollLeft = 0;

    if (typeof node.content === 'string') {
      const trimmed = node.content.trim();
      if (!trimmed) {
        viewerContent.textContent = '(empty file)';
        return;
      }

      if (looksLikeXml(trimmed)) {
        const formatted = formatXml(trimmed);
        const highlighted = buildHighlightedLines(formatted);
        viewerContent.innerHTML = `<code class="code-block">${renderHighlightedLines(highlighted)}</code>`;
        viewerContent.scrollTop = 0;
        viewerContent.scrollLeft = 0;
        enableFolding(viewerContent);
      } else {
        viewerContent.textContent = trimmed;
      }
    } else {
      viewerContent.textContent = 'Binary part – preview disabled.';
    }
  }
}

function buildTree(entries: ArchiveEntry[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    isDir: true,
    size: 0,
    content: null,
    children: [],
  };

  const lookup = new Map<string, TreeNode>();
  lookup.set('', root);

  const ensureDirectory = (path: string): TreeNode => {
    if (lookup.has(path)) {
      return lookup.get(path)!;
    }

    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const parent = ensureDirectory(parentPath);
    const name = path.split('/').pop() ?? path;
    const node: TreeNode = {
      name,
      path,
      isDir: true,
      size: 0,
      content: null,
      children: [],
    };

    parent.children.push(node);
    lookup.set(path, node);
    return node;
  };

  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sorted) {
    if (entry.is_dir) {
      ensureDirectory(entry.path);
      continue;
    }

    const parentPath = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/'))
      : '';
    const parent = ensureDirectory(parentPath);
    const name = entry.path.split('/').pop() ?? entry.path;

    const node: TreeNode = {
      name,
      path: entry.path,
      isDir: false,
      size: entry.size,
      content: entry.content ?? null,
      children: [],
    };

    parent.children.push(node);
  }

  sortChildren(root);

  return root;
}

function sortChildren(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  node.children.forEach(sortChildren);
}

function renderTree(container: HTMLElement, tree: TreeNode, onSelect: SelectHandler) {
  container.innerHTML = '';

  if (!tree.children.length) {
    container.innerHTML = '<p class="placeholder">Archive contains no entries.</p>';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'tree-root';

  for (const child of tree.children) {
    list.appendChild(createTreeNode(child, onSelect));
  }

  container.appendChild(list);
}

function createTreeNode(node: TreeNode, onSelect: SelectHandler): HTMLElement {
  const item = document.createElement('li');
  item.className = 'tree-node';

  if (node.isDir) {
    const details = document.createElement('details');
    details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = node.name || '/';
    details.appendChild(summary);

    const childList = document.createElement('ul');
    childList.className = 'tree-root';
    for (const child of node.children) {
      childList.appendChild(createTreeNode(child, onSelect));
    }

    details.appendChild(childList);
    item.appendChild(details);
  } else {
    const label = document.createElement('div');
    label.className = 'tree-label';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = node.name;
    button.dataset.path = node.path;
    button.addEventListener('click', () => onSelect(node, button));

    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatSize(node.size);

    label.append(button, size);
    item.appendChild(label);
  }

  return item;
}

function formatSize(size: number): string {
  if (!Number.isFinite(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function looksLikeXml(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

function formatXml(input: string): string {
  const normalized = input
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .replace(/</g, '\n<')
    .replace(/>/g, '>\n');

  const tokens = normalized
    .split('\n')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let indent = 0;
  const pad = (level: number) => '  '.repeat(Math.max(level, 0));

  return tokens
    .map((segment) => {
      if (segment.startsWith('<?') || segment.startsWith('<!--') || segment.startsWith('<!')) {
        return `${pad(indent)}${segment}`;
      }

      if (segment.startsWith('</')) {
        indent = Math.max(indent - 1, 0);
        return `${pad(indent)}${segment}`;
      }

      if (segment.startsWith('<')) {
        const trimmed = segment.replace(/\s+$/, '');
        const isSelfClosing = trimmed.endsWith('/>');
        const line = `${pad(indent)}${trimmed}`;
        if (!isSelfClosing && !trimmed.startsWith('<![CDATA[')) {
          indent += 1;
        }
        return line;
      }

      return `${pad(indent)}${segment}`;
    })
    .join('\n');
}

function buildHighlightedLines(formatted: string): HighlightedLine[] {
  const rawLines = formatted.split('\n');
  const lines = rawLines.map((line) => highlightLine(line));
  const stack: number[] = [];

  lines.forEach((line, index) => {
    if (line.type === 'open') {
      stack.push(index);
      return;
    }

    if (line.type === 'close') {
      for (let i = stack.length - 1; i >= 0; i--) {
        const openIndex = stack[i];
        const openLine = lines[openIndex];
        if (openLine.level === line.level) {
          openLine.matchIndex = index;
          line.matchIndex = openIndex;
          stack.splice(i, 1);
          break;
        }
      }
    }
  });

  return lines;
}

function renderHighlightedLines(lines: HighlightedLine[]): string {
  return lines
    .map((line, index) => {
      const foldable =
        line.type === 'open' && line.matchIndex !== undefined && line.matchIndex > index + 1;
      const toggle = foldable
        ? `<button class="code-fold" type="button" data-line="${index}" aria-label="Collapse section" aria-expanded="true">▾</button>`
        : '<span class="code-fold code-fold--placeholder"></span>';

      const attributes = [`class="code-line"`, `data-line="${index}"`, `data-type="${line.type}"`, `style="--indent:${line.level};"`];

      if (line.matchIndex !== undefined) {
        attributes.push(`data-match="${line.matchIndex}"`);
      }

      const content = line.contentHtml === '' ? '&nbsp;' : line.contentHtml;

      return `<span ${attributes.join(' ')}>${toggle}<span class="code-indent"></span><span class="code-text">${content}</span></span>`;
    })
    .join('');
}

function highlightLine(line: string): HighlightedLine {
  const indentMatch = line.match(/^\s*/)?.[0] ?? '';
  const level = Math.floor(indentMatch.length / 2);
  const trimmed = line.trim();

  if (!trimmed) {
    return { level, type: 'text', contentHtml: '' };
  }

  if (trimmed.startsWith('<!--')) {
    return {
      level,
      type: 'comment',
      contentHtml: `<span class="token-comment">${escapeHtml(trimmed)}</span>`,
    };
  }

  if (trimmed.startsWith('<?') || trimmed.startsWith('<!')) {
    return {
      level,
      type: 'declaration',
      contentHtml: `<span class="token-decl">${escapeHtml(trimmed)}</span>`,
    };
  }

  if (trimmed.startsWith('</')) {
    const tagName = trimmed.slice(2, trimmed.length - 1).trim();
    return {
      level,
      type: 'close',
      contentHtml: `&lt;/<span class="token-tag">${escapeHtml(tagName)}</span>&gt;`,
    };
  }

  if (trimmed.startsWith('<')) {
    const normalized = trimmed.replace(/\s+$/, '');
    const isSelfClosing = normalized.endsWith('/>');
    const closeIndex = normalized.lastIndexOf(isSelfClosing ? '/>' : '>');
    const inner = normalized.substring(1, closeIndex).trim();
    const { tagName, attributes } = parseTagInner(inner);

    let html = `&lt;<span class="token-tag">${escapeHtml(tagName)}</span>`;

    for (const attr of attributes) {
      if (!attr.name) {
        continue;
      }

      html += ' ';
      html += `<span class="token-attr">${escapeHtml(attr.name)}</span>`;
      if (attr.value !== null) {
        const quoted = attr.quote ? `${attr.quote}${attr.value}${attr.quote}` : attr.value;
        html += `<span class="token-punct">=</span><span class="token-string">${escapeHtml(quoted)}</span>`;
      }
    }

    html += isSelfClosing ? ' /&gt;' : '&gt;';

    const trailing = normalized.slice(closeIndex + (isSelfClosing ? 2 : 1)).trim();
    if (trailing.length > 0) {
      html += ` <span class="token-text">${escapeHtml(trailing)}</span>`;
    }

    return {
      level,
      type: isSelfClosing ? 'self' : 'open',
      contentHtml: html,
    };
  }

  return {
    level,
    type: 'text',
    contentHtml: `<span class="token-text">${escapeHtml(trimmed)}</span>`,
  };
}

function enableFolding(container: HTMLElement) {
  const codeBlock = container.querySelector<HTMLElement>('.code-block');
  if (!codeBlock) {
    return;
  }

  if (codeBlock.dataset.foldBound === 'true') {
    return;
  }

  codeBlock.dataset.foldBound = 'true';

  const listener = (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.code-fold');
    if (!target) {
      return;
    }

    toggleFold(codeBlock, target);
  };

  codeBlock.addEventListener('click', listener);
}

function toggleFold(codeBlock: Element, button: HTMLButtonElement) {
  const lineIndex = Number(button.dataset.line);
  if (!Number.isFinite(lineIndex)) {
    return;
  }

  const lineSelector = `.code-line[data-line="${lineIndex}"]`;
  const lineElement = codeBlock.querySelector<HTMLElement>(lineSelector);
  if (!lineElement) {
    return;
  }

  const matchAttr = lineElement.dataset.match;
  if (!matchAttr) {
    return;
  }

  const matchIndex = Number(matchAttr);
  if (!Number.isFinite(matchIndex) || matchIndex <= lineIndex + 1) {
    return;
  }

  const lines = Array.from(codeBlock.querySelectorAll<HTMLElement>('.code-line'));
  const collapsing = !button.classList.contains('is-collapsed');

  for (let i = lineIndex + 1; i < matchIndex; i++) {
    const target = lines[i];
    if (!target) {
      continue;
    }

    if (collapsing) {
      const hiddenBy = target.dataset.hiddenBy
        ? target.dataset.hiddenBy.split(',').filter(Boolean)
        : [];
      if (!hiddenBy.includes(String(lineIndex))) {
        hiddenBy.push(String(lineIndex));
      }
      target.dataset.hiddenBy = hiddenBy.join(',');
      target.classList.add('is-hidden');
    } else if (target.dataset.hiddenBy) {
      const remaining = target.dataset.hiddenBy
        .split(',')
        .filter((value) => value !== String(lineIndex) && value.length > 0);
      if (remaining.length > 0) {
        target.dataset.hiddenBy = remaining.join(',');
      } else {
        delete target.dataset.hiddenBy;
        target.classList.remove('is-hidden');
      }
    }
  }

  button.classList.toggle('is-collapsed', collapsing);
  button.setAttribute('aria-expanded', collapsing ? 'false' : 'true');
  lineElement.classList.toggle('is-folded', collapsing);
}

function parseTagInner(inner: string): { tagName: string; attributes: ParsedAttribute[] } {
  let index = 0;
  const length = inner.length;
  let tagName = '';

  while (index < length && !isWhitespace(inner[index])) {
    tagName += inner[index];
    index += 1;
  }

  const attributes: ParsedAttribute[] = [];

  while (index < length) {
    while (index < length && isWhitespace(inner[index])) {
      index += 1;
    }
    if (index >= length) {
      break;
    }

    let name = '';
    while (index < length && !isWhitespace(inner[index]) && inner[index] !== '=') {
      name += inner[index];
      index += 1;
    }

    if (!name) {
      break;
    }

    while (index < length && isWhitespace(inner[index])) {
      index += 1;
    }

    let value: string | null = null;
    let quote: '"' | "'" | '' = '';

    if (inner[index] === '=') {
      index += 1;
      while (index < length && isWhitespace(inner[index])) {
        index += 1;
      }

      if (inner[index] === '"' || inner[index] === "'") {
        quote = inner[index] as '"' | "'";
        index += 1;
        let buffer = '';
        while (index < length && inner[index] !== quote) {
          buffer += inner[index];
          index += 1;
        }
        value = buffer;
        if (inner[index] === quote) {
          index += 1;
        }
      } else {
        let buffer = '';
        while (index < length && !isWhitespace(inner[index])) {
          buffer += inner[index];
          index += 1;
        }
        value = buffer;
      }
    }

    attributes.push({ name, value, quote });
  }

  if (!tagName) {
    return { tagName: inner, attributes };
  }

  return { tagName, attributes };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function resetViewer() {
  if (activeButton) {
    activeButton.classList.remove('is-active');
    activeButton = null;
  }

  viewerTitle.textContent = 'No part selected';
  viewerContent.textContent = 'Upload a document and choose an XML file to preview its contents.';
}

function setStatus(message: string, variant: 'info' | 'error' | 'success' = 'info') {
  statusEl.textContent = message;
  statusEl.classList.remove('is-error', 'is-success');

  if (variant === 'error') {
    statusEl.classList.add('is-error');
  } else if (variant === 'success') {
    statusEl.classList.add('is-success');
  }
}

bootstrap();
