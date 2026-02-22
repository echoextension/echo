(function () {
  'use strict';

  const contentEl = document.getElementById('content');
  const backLink = document.getElementById('backLink');

  // 如果是从 options 页面打开的，显示返回按钮
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome && chrome.runtime && chrome.runtime.getURL) {
      window.location.href = chrome.runtime.getURL('options/options.html');
    } else {
      history.back();
    }
  });
  backLink.style.display = 'inline-block';

  // 从 URL 参数获取文件名
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file');

  if (!file) {
    contentEl.textContent = '缺少文件参数。用法：docs-viewer.html?file=PRIVACY_POLICY.md';
    return;
  }

  // 安全检查：只允许 .md 文件，且不允许路径穿越
  if (!file.endsWith('.md') || file.includes('..')) {
    contentEl.textContent = '无效的文件路径。';
    return;
  }

  // 获取插件内文件 URL
  let fileUrl;
  if (chrome && chrome.runtime && chrome.runtime.getURL) {
    fileUrl = chrome.runtime.getURL(file);
  } else {
    fileUrl = file; // 本地调试 fallback
  }

  fetch(fileUrl)
    .then(r => {
      if (!r.ok) throw new Error(`文件加载失败 (${r.status})`);
      return r.text();
    })
    .then(md => {
      contentEl.className = 'md-body';
      contentEl.innerHTML = renderMarkdown(md);
      // 更新标题
      const firstH1 = contentEl.querySelector('h1');
      if (firstH1) document.title = 'ECHO - ' + firstH1.textContent;
      // 生成浮动目录
      buildTOC();
    })
    .catch(err => {
      contentEl.className = 'status';
      contentEl.textContent = '文档加载失败：' + err.message;
    });

  /**
   * 轻量 Markdown 渲染器
   * 支持: h1-h4, bold, italic, inline code, code blocks, links,
   *        ul/ol (两级嵌套), hr, blockquote, paragraphs
   */
  function renderMarkdown(src) {
    // 规范化换行
    src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let html = '';
    const lines = src.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块 ```
      if (line.trimStart().startsWith('```')) {
        let rawLines = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
          rawLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        const code = rawLines.map(l => processCodeLine(l)).join('\n');
        html += `<pre><code>${code}</code></pre>\n`;
        continue;
      }

      // 分隔线 ---
      if (/^-{3,}\s*$/.test(line.trim()) || /^\*{3,}\s*$/.test(line.trim())) {
        html += '<hr>\n';
        i++;
        continue;
      }

      // 标题 # ~ ####
      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html += `<h${level}>${inline(headingMatch[2])}</h${level}>\n`;
        i++;
        continue;
      }

      // 引用 >
      if (line.trimStart().startsWith('>')) {
        let blockLines = [];
        while (i < lines.length && lines[i].trimStart().startsWith('>')) {
          blockLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html += `<blockquote><p>${inline(blockLines.join(' '))}</p></blockquote>\n`;
        continue;
      }

      // 无序列表 (- 或 *)
      if (/^[\s]*[-*]\s+/.test(line)) {
        const result = parseList(lines, i);
        html += result.html;
        i = result.end;
        continue;
      }

      // 有序列表
      if (/^[\s]*\d+[\.\)]\s+/.test(line)) {
        const result = parseList(lines, i);
        html += result.html;
        i = result.end;
        continue;
      }

      // 空行
      if (line.trim() === '') {
        i++;
        continue;
      }

      // 段落 - 收集连续非空行
      let pLines = [];
      while (i < lines.length && lines[i].trim() !== '' &&
             !lines[i].trimStart().startsWith('#') &&
             !lines[i].trimStart().startsWith('```') &&
             !lines[i].trimStart().startsWith('>') &&
             !/^-{3,}\s*$/.test(lines[i].trim()) &&
             !/^[\s]*[-*]\s+/.test(lines[i]) &&
             !/^[\s]*\d+[\.\)]\s+/.test(lines[i])) {
        pLines.push(lines[i]);
        i++;
      }
      if (pLines.length > 0) {
        html += `<p>${inline(pLines.join('\n'))}</p>\n`;
      }
    }

    return html;
  }

  /**
   * 解析列表 (支持递归多级嵌套、混合有序/无序)
   * 返回 { html, end } — end 是消耗到的行号
   */
  function parseList(lines, start) {
    const baseIndent = lines[start].match(/^(\s*)/)[1].length;
    // 判断当前层是有序还是无序
    const isOrdered = /^\s*\d+[\.\)]\s+/.test(lines[start]);
    const tag = isOrdered ? 'ol' : 'ul';
    const itemRegex = isOrdered ? /^(\s*)\d+[\.\)]\s+(.*)$/ : /^(\s*)[-*]\s+(.*)$/;

    const items = []; // { text, subLines[] }
    let i = start;

    while (i < lines.length) {
      // 跳过空行（loose list 支持）
      if (lines[i].trim() === '') { i++; continue; }

      const indent = lines[i].match(/^(\s*)/)[1].length;

      // 如果缩进小于基准，当前列表结束
      if (indent < baseIndent) break;

      // 如果缩进等于基准，应该是当前层的列表项
      if (indent === baseIndent) {
        const m = lines[i].match(itemRegex);
        if (m) {
          items.push({ text: m[2], subLines: [] });
          i++;
        } else {
          // 不是列表项（也不是缩进的续行），列表结束
          break;
        }
      } else {
        // 缩进大于基准 → 归入当前最后一个列表项的 subLines
        if (items.length > 0) {
          items[items.length - 1].subLines.push(lines[i]);
        }
        i++;
      }
    }

    let html = `<${tag}>\n`;
    items.forEach(item => {
      html += `<li>${inline(item.text)}`;
      if (item.subLines.length > 0) {
        // 找子内容中第一个列表项来决定是否递归
        const firstListLine = item.subLines.find(l => /^\s*[-*]\s+/.test(l) || /^\s*\d+[\.\)]\s+/.test(l));
        if (firstListLine) {
          const subResult = parseList(item.subLines, 0);
          html += '\n' + subResult.html;
        } else {
          // 纯续行文本
          html += ' ' + item.subLines.map(l => inline(l.trim())).join(' ');
        }
      }
      html += '</li>\n';
    });
    html += `</${tag}>\n`;

    return { html, end: i };
  }

  /**
   * 内联格式化: bold, italic, code, links
   */
  function inline(text) {
    text = escapeHtml(text);

    // 行内代码 `code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 加粗 **bold**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 斜体 *italic*（不匹配已被 strong 处理的）
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // 图片 / 视频 ![alt](src)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, src) {
      if (/\.(mp4|webm|ogg)$/i.test(src)) {
        return '<video src="' + src + '" autoplay loop muted playsinline style="max-width:100%;border-radius:8px;margin:12px 0;"></video>';
      }
      return '<img src="' + src + '" alt="' + alt + '" style="max-width:100%;border-radius:8px;margin:12px 0;" loading="lazy">';
    });

    // 链接 [text](url) - md 文件链接自动转为 docs-viewer 内查看
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, label, url) {
      if (url.endsWith('.md') && !url.startsWith('http')) {
        return '<a href="docs-viewer.html?file=' + encodeURIComponent(url) + '" target="_blank" rel="noopener">' + label + '</a>';
      }
      return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
    });

    // 换行
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 判断 Unicode 码点是否为东亚宽字符（占 2 个等宽位）
   */
  function isEastAsianWide(cp) {
    return (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK 统一表意文字
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK 扩展 A
      (cp >= 0x20000 && cp <= 0x2FA1F) || // CJK 扩展 B-F + 兼容补充
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK 兼容表意文字
      (cp >= 0x2E80 && cp <= 0x2FDF) ||   // CJK 部首
      (cp >= 0x3001 && cp <= 0x303F) ||   // CJK 符号和标点（排除 U+3000 表意空格）
      (cp >= 0x3040 && cp <= 0x30FF) ||   // 平假名 + 片假名
      (cp >= 0x3100 && cp <= 0x312F) ||   // 注音符号
      (cp >= 0x3200 && cp <= 0x33FF) ||   // 带圈 CJK + CJK 兼容
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // 全角 ASCII 变体
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // 全角符号
      (cp >= 0xAC00 && cp <= 0xD7AF)     // 韩文音节
    );
  }

  /**
   * 处理代码块中的一行：将东亚宽字符包裹在 <span class="cjk-char"> 中
   * 使其通过 CSS width:2ch 强制占据正好 2 个等宽字符位，解决对齐问题
   */
  function processCodeLine(rawLine) {
    let result = '';
    for (const char of rawLine) {
      const cp = char.codePointAt(0);
      if (isEastAsianWide(cp)) {
        result += '<span class="cjk-char">' + char + '</span>';
      } else {
        // 对非宽字符做 HTML 转义
        switch (cp) {
          case 38: result += '&amp;'; break;   // &
          case 60: result += '&lt;'; break;    // <
          case 62: result += '&gt;'; break;    // >
          case 34: result += '&quot;'; break;  // "
          default: result += char;
        }
      }
    }
    return result;
  }

  /**
   * 生成浮动目录 (TOC)
   */
  function buildTOC() {
    const tocNav = document.getElementById('toc');
    if (!tocNav) return;

    const headings = contentEl.querySelectorAll('h1, h2, h3');
    if (headings.length < 3) return; // 标题太少不值得显示 TOC

    // 给每个标题加 id
    headings.forEach((h, idx) => {
      if (!h.id) h.id = 'heading-' + idx;
    });

    // 生成目录链接
    let html = '';
    headings.forEach(h => {
      const level = h.tagName.toLowerCase(); // h1, h2, h3
      const text = h.textContent;
      html += '<a class="toc-item toc-' + level + '" href="#' + h.id + '" title="' + text.replace(/"/g, '&quot;') + '">' + text + '</a>';
    });
    tocNav.innerHTML = html;

    // 淡入显示
    requestAnimationFrame(() => tocNav.classList.add('show'));

    // 滚动高亮当前段落
    const tocItems = tocNav.querySelectorAll('.toc-item');
    let ticking = false;

    function updateActive() {
      let currentIdx = 0;
      const scrollY = window.scrollY + 100;

      headings.forEach((h, idx) => {
        if (h.offsetTop <= scrollY) currentIdx = idx;
      });

      tocItems.forEach((item, idx) => {
        item.classList.toggle('active', idx === currentIdx);
      });
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(updateActive);
        ticking = true;
      }
    });

    // 点击平滑滚动
    tocItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(item.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    updateActive();

    // 返回顶部按钮
    const topBtn = document.getElementById('backToTop');
    if (topBtn) {
      window.addEventListener('scroll', () => {
        topBtn.classList.toggle('show', window.scrollY > 400);
      });
      topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
})();
