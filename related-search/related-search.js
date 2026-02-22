/**
 * ECHO 网页关联搜索推荐模块
 * 
 * 在页面右下角显示与当前网页内容相关的搜索推荐词
 * 点击后在后台新标签页中打开 Bing 搜索
 * 
 * 关键词提取算法：
 * 使用 Pollinations.ai 免费 API 进行智能提取
 */

(async function() {
  'use strict';

  // 【修复】防止重复运行 (Idempotency Check) - 解决 Duplicate extraction
  if (window.__ECHO_RELATED_SEARCH_ACTIVE__) return;
  window.__ECHO_RELATED_SEARCH_ACTIVE__ = true;

  // 【修复】禁止在 iframe 中运行 - 解决 Overlapping display caused by frames
  if (window.self !== window.top) return;

  // 默认设置
  const DEFAULT_SETTINGS = {
    relatedSearchRecommend: false,  // 主开关
    relatedSearchFollowZoom: false, // 子选项：跟随页面缩放
    relatedSearchBlacklist: [],     // 黑名单域名列表 User defined
    
    // UI状态记忆
    relatedSearchPosition: { bottom: '160px', right: '12px' } 
  };

  // 加载设置
  let settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  // 如果功能未启用，直接返回
  if (!settings.relatedSearchRecommend) {
    return;
  }

  const hostname = window.location.hostname;

  // 1. IP 地址过滤 (内网/局域网/纯IP访问)
  // 匹配: 192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x.x.x, localhost
  // 以及简单的纯数字.点格式 (避免直接把IP发给AI)
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost';
  if (isIpAddress) {
    return;
  }

  // 2. 敏感域名硬编码拦截
  const sensitiveInfix = ['.gov', '.mil', '.edu', 'internal', 'private', 'corp', 'test'];
  if (sensitiveInfix.some(s => hostname.includes(s))) {
    return;
  }

  // 3. 用户黑名单检查
  if (settings.relatedSearchBlacklist.some(domain => hostname.includes(domain))) {
    return;
  }

  // 4. 在 bing.com 域名下不显示 (避免套娃)
  if (hostname.includes('bing.com')) {
    return;
  }

  // 5. 在搜索引擎结果页不显示
  const searchEngines = ['google.com', 'baidu.com', 'sogou.com', 'so.com', 'duckduckgo.com', 'yahoo.com'];
  if (searchEngines.some(se => hostname.includes(se))) {
    return;
  }

  // 6. 首页检测 (SPA 增强版)
  // 如果是网站根路径，或者仅仅带有一些追踪参数，视为首页
  if (isHomePage()) {
    return;
  }
  if (isHomePage()) {
    return;
  }

  /**
   * 判断是否是网站首页/根目录
   */
  function isHomePage() {
    const path = window.location.pathname;
    const search = window.location.search;
    
    // 典型首页路径模式
    const homePatterns = [
      /^\/?$/,                    // 空或单个斜杠
      /^\/index\.html?$/i,       
      /^\/home\.html?$/i,        
      /^\/default\.html?$/i,     
      /^\/index\.php$/i,         
      /^\/index\.aspx?$/i,       
      /^\/home\/?$/i,            
      /^\/main\/?$/i             
    ];
    
    // 检查路径是否匹配首页模式
    const isHomeByPath = homePatterns.some(pattern => pattern.test(path));
    
    // 如果路径是首页，即使带有 query string 也要更激进地识别
    if (isHomeByPath) {
      if (!search) return true; // 无参数肯定是首页
      
      // 扩充白名单：这些参数的存在不改变“这是首页”的事实
      // 包含主流追踪参数 (utm, ref, from), B站/阿里系 (spm), 百度/统计 (hmsr, hmpl), 
      // 视频站 (vd_source), 以及常见的时间戳/随机数
      const allowedPatterns = [
        /^utm_/, /^Ref/i, /^from/i, 
        /^spm/i, /^vd_source/i,      // B站、阿里系核心参数
        /^hmsr/i, /^hmpl/i,          // 统计参数
        /^fbclid/, /^gclid/,         // 广告ID
        /^timestamp/, /^t$/, /^v$/   // 缓存相关
      ];
      
      const params = new URLSearchParams(search);
      
      // 检查是否所有参数都是“允许的无关参数”
      // 只要发现一个不在白名单里的参数（比如 ?id=123），就视为内页，放行
      const hasContentParam = [...params.keys()].some(key => {
          // 如果 key 匹配任一白名单正则，则不是内容参数
          const isAllowed = allowedPatterns.some(pattern => pattern.test(key));
          return !isAllowed;
      });
      
      if (!hasContentParam) {
        return true; 
      }
    }
    
    return false;
  }

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.relatedSearchRecommend) {
      settings.relatedSearchRecommend = changes.relatedSearchRecommend.newValue;
      if (!settings.relatedSearchRecommend && shadowHost) {
        // 功能被关闭，隐藏组件
        shadowHost.style.display = 'none';
      }
      // 注意：如果功能被重新开启，不自动重新显示（需要刷新页面）
    }
    if (areaName === 'sync' && changes.relatedSearchFollowZoom) {
      settings.relatedSearchFollowZoom = changes.relatedSearchFollowZoom.newValue;
      if (shadowHost) {
        checkAndApplyZoom();
      }
    }
  });

  // ============================================
  // AI 关键词提取 (Pollinations.ai)
  // ============================================

  /**
   * 从页面提取关键词（入口函数）
   * 使用 Pollinations.ai 免费 API 提取
   * @param {number} retryCount - 重试次数
   */
  async function extractKeywords(retryCount = 0) {
    // 1. 获取页面主要内容
    const content = getMainContent().trim();
    
    // 检查内容长度
    if (!content || content.length < 50) {
      // 添加前端重试机制 (针对 SPA 动态加载)，这里不消耗 API Quota，所以可以重试
      if (retryCount < 2) {
        await new Promise(r => setTimeout(r, 2500));
        return extractKeywords(retryCount + 1);
      }
      
      return null;
    }

    // 1.1 内容信噪比检测 (防误判B站首页等)
    // 如果大量短语拼接（换行符多，但每行都很短），可能是聚合页链接列表
    const lines = content.split('\n');
    const validLines = lines.filter(l => l.trim().length > 0);
    const avgLineLen = validLines.reduce((acc, l) => acc + l.length, 0) / (validLines.length || 1);
    
    // 聚合页特征：总字数不少，但没有长句子，全是标题
    const hasLongParagraph = lines.some(l => l.length > 80); // 是否有超过80字的段落
    if (!hasLongParagraph && avgLineLen < 30) {
       return null;
    }
    
    // 截取前 1000 个字符用于分析，给予 AI 更多上下文
    const textToAnalyze = content.slice(0, 1000).replace(/\s+/g, ' ');

    // 2. 构造 Prompt - 保持不变 (User Requirement)
    const prompt = `
      Role: You are a curious university student.
      Task: List 4-6 deep follow-up search queries to understand this topic better.
      
      Requirements:
      1. **Content**: Focus on Causes, Solutions, Comparisons, or Future Trends.
      2. **Format**: Return a **plain list** only. Each query on a new line. NO numbers, NO bullets, NO quotes, NO json.
      3. **Length**: 6-14 Chinese chars (or 4-10 English words) per line.
      4. **Language**: Same as source text.
      
      Example Output:
      Why sky is blue physics
      1935 年英德海军协议的历史背景
      Rayleigh scattering vs Mie scattering
      
      Text to Analyze:
      ${textToAnalyze}
    `;

    // 3. 调用 Pollinations.ai API
    try {
        const responseData = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'analyzeText', prompt: prompt }, (response) => {
                if (chrome.runtime.lastError || (response && response.error)) {
                    reject(new Error(chrome.runtime.lastError?.message || response?.error));
                } else {
                    resolve(response.data);
                }
            });
        });

        const text = responseData; // Raw response (could be JSON object string, or plain text)

        // 3.5 预处理：将字面量 \n \r\n 转为真实换行符
        // 免费 AI 接口可能返回 JSON 编码的文本，其中换行符是字面量 backslash+n 而非真实换行
        const normalizedText = text ? text.replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '\r') : text;
        
        // 4. 解析 - 增强版混合解析器
        let keywords = [];
        
        if (normalizedText) {
            let processed = false;

            // 策略 A: 优先尝试 JSON 解析 (Handle [object Object] case)
            try {
                // 提取最外层的 {} 或 []
                // 注意：由于 AI 可能返回 markdown ```json ... ```，先尝试去除 markdown
                const cleanTextForJson = normalizedText.replace(/```(?:json)?|```/g, '').trim();
                const jsonMatch = cleanTextForJson.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    
                    // 辅助函数：从对象中提取可能的文本字段，并尝试分割
                    const extractKeywordsFromObj = (obj) => {
                       // 【防干扰】移除思维链字段，避免误提思考过程
                       const safeObj = { ...obj };
                       ['reasoning_content', 'reasoning', 'thought', 'thoughts'].forEach(k => delete safeObj[k]);

                       let rawText = null;
                       const candidateKeys = ['query', 'keyword', 'text', 'search_query', 'content', 'question', 'suggestion'];
                       
                       // 1. 尝试找常见 key
                       for (const key of candidateKeys) {
                          if (safeObj[key] && typeof safeObj[key] === 'string') {
                              rawText = safeObj[key];
                              break;
                          }
                       }
                       // 2. 没找到，找第一个长字符串 value
                       if (!rawText) {
                           rawText = Object.values(safeObj).find(v => typeof v === 'string' && v.length > 2);
                       }

                       if (!rawText) return [];

                       // 核心修复：检查是否包含换行符，如果包含则分割
                       if (rawText.includes('\n')) {
                           return rawText.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
                       }
                       return [rawText];
                    };

                    if (Array.isArray(parsed)) {
                        keywords = parsed.flatMap(item => { // 使用 flatMap 展开
                           if (typeof item === 'string') return [item];
                           if (typeof item === 'object' && item !== null) return extractKeywordsFromObj(item);
                           return [];
                        });
                        if (keywords.length > 0) processed = true;

                    } else if (typeof parsed === 'object' && parsed !== null) {
                        // 【清洗】移除推理字段
                        ['reasoning_content', 'reasoning', 'thought', 'thoughts'].forEach(k => delete parsed[k]);

                        // 针对 { "queries": [...] } 结构
                        const values = Object.values(parsed);
                        const arrayVal = values.find(v => Array.isArray(v)); 
                        
                        if (arrayVal) {
                             keywords = arrayVal.flatMap(item => {
                                if (typeof item === 'string') return [item];
                                if (typeof item === 'object' && item !== null) return extractKeywordsFromObj(item);
                                return [];
                             });
                             if (keywords.length > 0) processed = true;
                        } else {
                             // 针对 { "content": "Line1\nLine2..." } 这种单字段包含多行的情况
                             // 或者是 { "1": "query1", "2": "query2" }
                             
                             // 优先检查是否有 value 包含换行符
                             const multiLineValue = values.find(v => typeof v === 'string' && v.includes('\n'));
                             if (multiLineValue) {
                                 keywords = multiLineValue.split(/\r?\n/).map(s => s.trim());
                             } else {
                                 // 否则取所有 string values
                                 keywords = values.filter(v => typeof v === 'string' && v.trim().length > 0);

                                 // 【鲁棒性增强】如果 Values 无效 (如 {"Keyword": ""})，尝试提取 Keys
                                 if (keywords.length === 0) {
                                     const keys = Object.keys(parsed).filter(k => 
                                         k.length > 2 && !['role', 'content', 'model', 'system', 'user', 'assistant'].includes(k.toLowerCase())
                                     );
                                     if (keys.length > 0) {
                                         keywords = keys;
                                     }
                                 }
                             }
                             
                             if (keywords.length > 0) processed = true;
                        }
                    }
                }
            } catch (e) {
            }

            // 策略 B: 如果 JSON 失败，尝试正则提取引号内容 (针对 malformed JSON)
            if (!processed && (normalizedText.includes('"') || normalizedText.includes("'"))) {
                const quoteRegex = /"([^"]+)"/g;
                let match;
                while ((match = quoteRegex.exec(normalizedText)) !== null) {
                    const str = match[1];
                    // 过滤 key (如 "role": "assistant")
                    if (str.length > 4 && !str.includes('":') && !['assistant', 'user', 'system'].includes(str)) {
                        keywords.push(str);
                    }
                }
                if (keywords.length > 0) processed = true;
            }

            // 策略 C: 纯文本按行分割 (Text Fallback)
            if (!processed) {
                 const cleanText = normalizedText.replace(/```[\s\S]*?```/g, '').replace(/```/g, '');
                 const lines = cleanText.split(/\r?\n/);
                 
                 keywords = lines.map(line => {
                     return line.trim()
                         .replace(/^(\d+[\.\)\-]\s*|[\-\*\>•]\s*)/, '') // 只去除序号格式(1. 2) 3-)和bullet符号，不误删年份
                         .replace(/^["']|["']$/g, '')        // 去除两端引号
                         .replace(/^[{\[]+|[}\]]+$/g, '')    // 去除两端 JSON 结构符号 {}[]
                         .trim();
                 });
            }
        }

        // 最终清洗
        const uniqueKeywords = [...new Set(keywords)].map(k => String(k).trim().replace(/^[{\["']+|[}\]"']+$/g, '').trim()).filter(k => {
             const len = k.length;
             
             // 检测是否包含中日韩字符 (CJK)
             const isCJK = /[\u4e00-\u9fa5]/.test(k);
             
             if (isCJK) {
                 if (len < 4) return false;  // 放宽到4
                 if (len > 35) return false;
             } else {
                 if (len < 10) return false;
                 if (!k.includes(' ')) return false; 
                 if (len > 100) return false;
             }

             if (/^[\d\p{P}\s]+$/u.test(k)) return false;
             if (k.includes('":')) return false; // JSON key fragment check

             const blockList = ['null', 'undefined', 'search', 'keywords', 'queries', 'results', 'list', 'example', 'output', 'json', 'response'];
             if (blockList.includes(k.toLowerCase())) return false;
             
             // 检查是否和 Title 过于相似 (避免 "Bilibili" 这种词)
             if (document.title.includes(k) && k.length < 5) return false;

             return true;
        });


        if (uniqueKeywords.length >= 3) {
            return uniqueKeywords.slice(0, 6); 
        } else {
            throw new Error(`Insufficient keywords found: ${uniqueKeywords.length} (min 3 required)`);
        }

    } catch (e) {
        console.error('[ECHO] AI 提取失败:', e);
        return null; // 失败直接返回 null
    }
  }

  /**
   * 默认关键词（提取失败时使用）
   */
  function getDefaultKeywords() {
    const hostname = window.location.hostname;
    
    if (hostname.includes('github')) {
      return ['开源项目', 'GitHub', '代码仓库', '开发者'];
    } else if (hostname.includes('zhihu')) {
      return ['知乎', '问答', '专业讨论', '知识分享'];
    } else if (hostname.includes('bilibili')) {
      return ['B站', '视频', 'UP主', '弹幕'];
    } else if (hostname.includes('weibo')) {
      return ['微博', '热搜', '话题', '动态'];
    } else if (hostname.includes('douyin') || hostname.includes('tiktok')) {
      return ['短视频', '抖音', '热门', '推荐'];
    }
    
    return ['相关内容', '延伸阅读', '热门推荐', '更多资讯'];
  }

  /**
   * 获取页面主要内容文本
   */
  function getMainContent() {
    // 针对特定网站的优化选择器
    // 注意：不再只取第一个匹配的，而是尝试获取所有相关内容
    const siteSelectors = {
      'zhihu.com': ['.QuestionHeader-title', '.RichContent-inner', '.Post-RichText', '.AnswerCard', '[itemprop="text"]'],
      'bilibili.com': ['.video-title', '.video-desc', '.article-content'],
      'weibo.com': ['.wbpro-feed-content', '.woo-box-item-main'],
      'toutiao.com': ['.article-content', 'h1', 'article'],
      'csdn.net': ['#content_views', '.title-article'],
      'juejin.cn': ['.article-content', '.article-title'],
      'github.com': ['#readme', '.markdown-body', 'article']
    };

    let specificSelectors = [];
    for (const domain in siteSelectors) {
      if (window.location.hostname.includes(domain)) {
        specificSelectors = siteSelectors[domain];
        break;
      }
    }

    // 策略：如果匹配到了特定网站的 selectors，我们尝试将它们全部拼接起来
    // 这样可以避免只抓取到标题而漏掉正文的情况
    let gatheredText = '';
    
    if (specificSelectors.length > 0) {
        specificSelectors.forEach(sel => {
            const els = document.querySelectorAll(sel);
            els.forEach(el => {
                if (el && el.innerText) {
                    gatheredText += el.innerText + '\n';
                }
            });
        });
    }

    // 如果特定选择器抓取到了足够的内容(>100字符)，直接使用
    if (gatheredText.length > 100) {
        return (document.title + "\n" + gatheredText).trim();
    }

    // 如果没有特定选择器或者特定选择器抓取失败，回退到通用查找
    // 尝试找到主内容区域
    const mainSelectors = [
      'article', 'main', '.content', '.article', '.post', '.entry',
      '#content', '#main', '.main-content', '.post-content', '.article-content',
      '[role="main"]', '.body', '.text', '.story'
    ];
    
    let mainElement = null;
    let usedSelector = '';
    
    // 寻找最长文本的元素，而不是第一个匹配的
    let maxLen = 0;

    for (const selector of mainSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText) {
          const len = el.innerText.trim().length;
          if (len > maxLen && len > 50) { // 至少50字
              maxLen = len;
              mainElement = el;
              usedSelector = selector;
          }
      }
    }
    
    // 如果没找到，或者找到的内容太少，回退使用 body
    if (!mainElement) {
      mainElement = document.body;
      usedSelector = 'body';
    } else {
    }

    // 克隆并移除不需要的元素
    const clone = mainElement.cloneNode(true);
    const removeSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript',
      '.nav', '.menu', '.sidebar', '.footer', '.header', '.ad', '.ads',
      '.advertisement', '.comment', '.comments', '[role="navigation"]',
      '.related', '.recommend', '.share', '.social', 'iframe',
      '.top-nav', '.bottom-nav', '.right-rail', '.left-rail', // Generic layout
      '#comments', '#sidebar'
    ];
    
    try {
        removeSelectors.forEach(sel => {
            const elements = clone.querySelectorAll(sel);
            elements.forEach(el => el.remove());
        });
    } catch(e) {
        console.warn('[ECHO DEBUG] Clean up error:', e);
    }
    
    // 增加对 title 的权重：把页面标题加到内容最前面
    const pageTitle = document.title;
    const finalContent = pageTitle + "\n" + (clone.innerText || clone.textContent || '');
    
    return finalContent;
  }

  // ============================================
  // 样式定义 - 参考超级 Bing 搜索框（浅色 + 彩虹光谱边框，不旋转）
  // ============================================

  const getStyles = () => `
    :host {
      all: initial;
      position: fixed !important;
      bottom: var(--echo-bottom, 20px); /* 通过 CSS 变量动态控制，用于反向缩放补偿 */
      right: var(--echo-right, 12px);   /* 通过 CSS 变量动态控制，用于反向缩放补偿 */
      left: auto;
      top: auto;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      /* 确保自身不阻挡鼠标事件（内部元素会捕获） */
      pointer-events: auto;
    }

    /* 主容器 - 使用 column-reverse 让胶囊固定在底部 */
    .related-search-container {
      display: flex;
      flex-direction: column-reverse; /* 胶囊在底部，内容向上展开 */
      align-items: flex-end; /* 靠右对齐 */
      gap: 8px;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.5s ease, transform 0.5s ease;
      position: relative;
    }

    .related-search-container.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* ============================================
       Peek 指示器 — 竖版迷你胶囊 (彩虹边框 + 白色填充)
       绝对定位，脱离 flex 流，与 trigger 垂直居中对齐
       ============================================ */
    .peek-indicator {
      width: 14px;
      height: 56px;
      border-radius: 7px;
      background: transparent;
      position: absolute;
      right: 2px;
      bottom: -8px;
      cursor: pointer;
      transform-origin: center center;
      transition: opacity 0.8s ease, transform 0.2s ease, translate 0.1s ease, height 0.1s ease, margin 0.1s ease, box-shadow 0.1s ease;
      opacity: 0;
      translate: 6px 0;
      transform: scale(1);
      pointer-events: none;
      z-index: 10;
      overflow: hidden;
      box-shadow: -1px 0 8px rgba(0, 0, 0, 0.08), 0 0 8px rgba(168, 132, 252, 0.2);
    }

    /* 旋转彩虹背景层 (超大正方形，被父级 overflow:hidden + border-radius 裁切) */
    .peek-indicator::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 120px;
      height: 120px;
      transform-origin: center center;
      transform: translate(-50%, -50%) rotate(0deg);
      background: conic-gradient(
        from 0deg,
        #f472b6, #c084fc, #818cf8, #38bdf8, #34d399, #fbbf24, #f472b6
      );
      animation: peekRainbowSpin 6s linear infinite;
      pointer-events: none;
    }

    /* 内芯 — 陶瓷釉面质感（参考 FRE1 icon-box） */
    .peek-indicator::after {
      content: '';
      position: absolute;
      inset: 2px;
      border-radius: 5px;
      background: linear-gradient(160deg, #ffffff, #f5f5f7);
      box-shadow: inset 0 1px 2px rgba(255,255,255,1);
      z-index: 1;
      pointer-events: none;
    }

    @keyframes peekRainbowSpin {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    /* 竖版胶囊 - 透明感应区 (同级元素，不受 overflow:hidden 裁切) */
    .peek-hitarea {
      position: absolute;
      right: -21px;
      bottom: -28px;
      width: 56px;
      height: 112px;
      border-radius: 20px;
      background: transparent;
      z-index: 11;
      cursor: pointer;
    }

    /* Expanded 态隐藏感应区 */
    .related-search-container.expanded .peek-hitarea {
      pointer-events: none;
    }
    .related-search-container.peek .peek-hitarea {
      pointer-events: auto;
    }

    .peek-indicator.peek-hovered {
      height: 72px;
      margin-bottom: -8px;
      box-shadow: -1px 0 14px rgba(0, 0, 0, 0.12), 0 0 12px rgba(168, 132, 252, 0.3);
    }

    /* ============================================
       Peek / Expanded 状态切换
       ============================================ */
    /* Peek 态: indicator 可见, trigger 隐藏 */
    .related-search-container.peek .peek-indicator {
      opacity: 1;
      translate: 0 0;
      transform: scale(1);
      pointer-events: auto;
    }
    .related-search-container.peek .search-trigger {
      opacity: 0;
      transform: scale(0);
      pointer-events: none;
    }

    /* Expanded 态: indicator 隐藏, trigger 可见 (作为底部标识) */
    .related-search-container.expanded .peek-indicator {
      opacity: 0;
      translate: 6px 0;
      transform: scale(0);
      pointer-events: none;
    }
    .related-search-container.expanded .search-trigger {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
      cursor: pointer;
    }

    /* ============================================
       胶囊触发按钮 (复用 v2.3.1 样式)
       ============================================ */
    .search-trigger {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 9px 13px 9px 20px;
      background: linear-gradient(160deg, #ffffff, #f5f5f7);
      border-radius: 20px;
      color: #333;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      position: relative;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08), inset 0 1px 2px rgba(255,255,255,1);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: right center;
      opacity: 0;
      transform: scale(0);
      pointer-events: none;
    }

    /* 彩虹光谱边框 - 静态不旋转 */
    .search-trigger::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 20px;
      padding: 1.5px;
      background: conic-gradient(
        from 0deg,
        #f472b6, #c084fc, #818cf8, #38bdf8, #34d399, #fbbf24, #f472b6
      );
      -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    /* 外发光效果 */
    .search-trigger::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 22px;
      background: conic-gradient(
        from 0deg,
        rgba(244, 114, 182, 0.3),
        rgba(192, 132, 252, 0.3),
        rgba(129, 140, 248, 0.3),
        rgba(56, 189, 248, 0.3),
        rgba(52, 211, 153, 0.3),
        rgba(251, 191, 36, 0.3),
        rgba(244, 114, 182, 0.3)
      );
      -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      filter: blur(4px);
      opacity: 0.6;
      z-index: -1;
      pointer-events: none;
    }

    .search-trigger:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .search-trigger:active {
      transform: translateY(0);
    }

    .search-trigger .trigger-text {
      font-weight: 500;
      letter-spacing: 0.2px;
      position: relative;
      z-index: 1;
      transform: translateY(-0.5px);
    }

    .toggle-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      margin-left: 0px;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      z-index: 1;
      transform: rotate(0deg); /* 收起态，箭头向上 */
    }

    .toggle-indicator svg {
      width: 10px;
      height: 10px;
      color: #666;
    }

    /* 展开态箭头向下 */
    .related-search-container.expanded .toggle-indicator {
      transform: rotate(180deg);
    }

    /* ============================================
       展开内容区域
       ============================================ */
    .expanded-content {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }

    .related-search-container.expanded .expanded-content {
      max-height: 400px;
      opacity: 1;
      pointer-events: auto;
    }

    /* 顶部控制栏 (展开时显示) */
    .controls-row {
      width: 100%;
      height: 24px;
      margin-bottom: 0px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    /* 右上角按钮组 (⋯ + 收起) */
    .controls-right {
      position: absolute;
      right: 0;
      top: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      z-index: 10;
    }

    /* 拖拽把手 - 胶囊状 */
    .drag-handle-pill {
      width: 44px;
      height: 6px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      cursor: grab;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      z-index: 5;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(4px);
    }
    
    .drag-handle-pill::after {
        content: '';
        position: absolute;
        top: -10px; bottom: -10px; left: -10px; right: -10px;
    }

    .related-search-container:hover .drag-handle-pill {
      background: rgba(0,0,0,0.4); 
    }

    .drag-handle-pill:hover {
      width: 53px;
      background: #0078d4 !important;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 1), 0 2px 4px rgba(0,0,0,0.2);
    }

    .drag-handle-pill:active {
      cursor: grabbing;
      background: #0078d4 !important;
    }
    
    /* 收起按钮 (展开态顶部) - 向下箭头 */
    .collapse-btn {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #999;
      background: transparent;
      transition: all 0.2s;
      z-index: 10;
      transform: rotate(180deg); /* 旋转箭头向下 */
    }
    
    .collapse-btn:hover {
      background: rgba(0, 0, 0, 0.1);
      color: #666;       
    }
    
    .collapse-btn svg {
      width: 14px;
      height: 14px;
    }

    /* 溢出菜单按钮 (⋯) */
    .more-btn {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #999;
      background: transparent;
      transition: all 0.2s;
      z-index: 10;
      font-size: 16px;
      line-height: 1;
      letter-spacing: 1px;
    }
    
    .more-btn:hover {
      background: rgba(0, 0, 0, 0.1);
      color: #666;
    }

    /* 搜索词标签容器 */
    .search-tags {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      max-width: 320px;
    }

    /* 单个搜索词标签 - 浅色毛玻璃 + 彩虹光谱边框 */
    .search-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px;
      font-size: 13px;
      color: #000;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      max-width: 300px;
      text-align: left;
      position: relative;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* 双行标签 */
    .search-tag.two-line {
      white-space: normal;
      align-items: center;
    }

    .search-tag.two-line .tag-icon {
      flex-shrink: 0;
    }

    .search-tag.two-line .search-tag-text {
      text-align: left;
    }

    /* 标签的彩虹边框 */
    .search-tag::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 16px;
      padding: 1px;
      background: conic-gradient(
        from 0deg,
        rgba(244, 114, 182, 0.5),
        rgba(192, 132, 252, 0.5),
        rgba(129, 140, 248, 0.5),
        rgba(56, 189, 248, 0.5),
        rgba(52, 211, 153, 0.5),
        rgba(251, 191, 36, 0.5),
        rgba(244, 114, 182, 0.5)
      );
      -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      opacity: 0.6;
      transition: opacity 0.2s;
    }

    .search-tag:hover {
      background: rgba(255, 255, 255, 1);
      transform: translateX(-4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }

    .search-tag:hover::before {
      opacity: 1;
    }

    .search-tag .tag-icon {
      width: 12px;
      height: 12px;
      color: #0078d4;
      opacity: 0.7;
      flex-shrink: 0;
      transition: opacity 0.2s;
    }

    .search-tag:hover .tag-icon {
      opacity: 1;
    }

    .search-tag:active {
      transform: scale(0.96) translateX(-2px);
      background: rgba(240, 240, 240, 0.95);
    }

    /* 右键菜单 */
    .context-menu {
      position: absolute;
      z-index: 9999;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(12px);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      padding: 4px;
      display: none;
      flex-direction: column;
      min-width: 140px;
      border: 1px solid rgba(0,0,0,0.08);
      font-size: 13px;
      color: #333;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      transform-origin: bottom right;
    }
    
    .context-menu.show {
      display: flex;
      animation: menuFadeIn 0.1s ease-out;
    }
    
    @keyframes menuFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .ctx-item {
      padding: 6px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      border-radius: 4px;
      transition: background 0.1s;
      white-space: nowrap;
    }

    .ctx-item:hover {
      background: #f3f4f6;
    }
    
    .ctx-item svg {
      width: 14px;
      height: 14px;
      opacity: 0.6;
    }

    /* Snackbar 通知 */
    .echo-snackbar {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(30, 30, 30, 0.95);
      backdrop-filter: blur(8px);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      z-index: 2000;
      white-space: nowrap;
    }

    .echo-snackbar.show {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    .echo-snackbar-btn {
      color: #60a5fa; 
      cursor: pointer;
      font-weight: 500;
      user-select: none;
    }
    .echo-snackbar-btn:hover {
      text-decoration: underline;
    }

    /* 深色模式适配 */
    @media (prefers-color-scheme: dark) {
      .search-trigger {
        background: linear-gradient(160deg, #f3f3f5, #ececef);
        color: #333;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 2px rgba(255,255,255,0.6);
      }

      .toggle-indicator svg {
        color: #9ca3af;
      }

      .search-tag {
        background: rgba(55, 55, 58, 0.85);
        color: #e5e7eb;
      }
      .search-tag:hover {
        background: rgba(75, 75, 78, 0.95);
        color: #fff;
      }
      .search-tag:active {
        background: rgba(85, 85, 88, 0.95);
      }
      .drag-handle-pill {
        background: rgba(0,0,0,0.3);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
      }
      .related-search-container:hover .drag-handle-pill {
        background: rgba(0,0,0,0.4);
      }
      .drag-handle-pill:hover {
        background: #0078d4 !important;
      }
      .collapse-btn {
        color: #666;
      }
      .collapse-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #333;
      }
      .more-btn {
        color: #666;
      }
      .more-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #333;
      }
      .context-menu {
        background: rgba(40, 40, 40, 0.95);
        border-color: rgba(255,255,255,0.1);
        color: #e5e7eb;
      }
      .ctx-item:hover {
        background: rgba(255,255,255,0.1);
      }
      .echo-snackbar {
        background: rgba(50, 50, 50, 0.95);
        color: #fff;
      }
      .peek-indicator {
        background: transparent;
        box-shadow: -1px 0 8px rgba(0, 0, 0, 0.3), 0 0 8px rgba(168, 132, 252, 0.15);
      }
      .peek-indicator::after {
        background: linear-gradient(160deg, #f3f3f5, #ececef);
        box-shadow: inset 0 1px 2px rgba(255,255,255,0.5);
      }
      .peek-indicator.peek-hovered {
        box-shadow: -1px 0 14px rgba(0, 0, 0, 0.4), 0 0 12px rgba(168, 132, 252, 0.25);
      }
    }
  `;

  // ============================================
  // SVG 图标
  // ============================================
  const ICONS = {
    search: `<svg class="tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
    block: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
  };

  // ============================================
  // Widget 创建与交互
  // ============================================

  let shadowHost = null;
  let shadowRoot = null;
  let container = null;
  let isExpanded = false; // 默认收起
  let isPeek = true;       // Peek 待机态

  // Peek 点击拖拽区分
  let peekMouseDownTime = 0;
  let peekMouseDownPos = { x: 0, y: 0 };
  
  // 缩放补偿相关变量
  let zoomCheckInterval = null;
  let currentZoomLevel = 1;

  // ============================================
  // 缩放补偿功能
  // ============================================

  /**
   * 初始化缩放补偿
   * 定期检查页面缩放级别并应用反向补偿
   */
  function initZoomCompensation() {
    // 清理之前的定时器
    if (zoomCheckInterval) {
      clearInterval(zoomCheckInterval);
      zoomCheckInterval = null;
    }

    // 立即检查一次
    checkAndApplyZoom();

    // 每500ms检查一次缩放变化
    zoomCheckInterval = setInterval(checkAndApplyZoom, 500);
  }

  /**
   * 检查缩放级别并应用
   */
  function checkAndApplyZoom() {
    if (!shadowHost) return;

    chrome.runtime.sendMessage({ action: 'getZoom' }, (response) => {
      if (chrome.runtime.lastError) {
        // console.warn('[ECHO] 获取缩放级别失败:', chrome.runtime.lastError);
        return;
      }

      if (response && response.zoom) {
        const newZoom = response.zoom;
        if (newZoom !== currentZoomLevel) {
          currentZoomLevel = newZoom;
          applyZoomCompensation(newZoom);
        }
      }
    });
  }

  // 固定定位常量（以 100% 缩放时的 CSS 像素计）
  const BOTTOM_OFFSET_PX = 20;
  const RIGHT_OFFSET_PX = 12;

  /**
   * 应用缩放补偿
   * @param {number} zoom - 当前页面缩放级别
   */
  function applyZoomCompensation(zoom) {
    if (!shadowHost) return;

    // 读取当前逻辑 bottom（可能被拖拽修改过）
    const logicalBottom = shadowHost._logicalBottom || BOTTOM_OFFSET_PX;

    // 如果设置为跟随页面缩放，则不做补偿
    if (settings.relatedSearchFollowZoom) {
      shadowHost.style.transform = '';
      shadowHost.style.transformOrigin = '';
      shadowHost.style.setProperty('--echo-bottom', `${logicalBottom}px`);
      shadowHost.style.setProperty('--echo-right', `${RIGHT_OFFSET_PX}px`);
      return;
    }

    // 应用反向缩放补偿，让UI保持原始大小
    const scale = 1 / zoom;
    shadowHost.style.transform = `scale(${scale})`;
    shadowHost.style.transformOrigin = 'bottom right';

    // 位置补偿：确保“物理像素”意义上的 bottom/right 距离恒定
    // 物理距离 = CSS像素 * zoom，要保持物理距离不变，则 CSS像素 = 原始值 / zoom
    shadowHost.style.setProperty('--echo-bottom', `${logicalBottom * scale}px`);
    shadowHost.style.setProperty('--echo-right', `${RIGHT_OFFSET_PX * scale}px`);
  }

  /**
   * 清理缩放补偿
   */
  function cleanupZoomCompensation() {
    if (zoomCheckInterval) {
      clearInterval(zoomCheckInterval);
      zoomCheckInterval = null;
    }
  }

  // ============================================
  // Widget 创建与交互
  // ============================================

  /**
   * 创建并显示 Widget
   * 只有在确定有关键词时才调用此函数
   * @param {string[]} keywords - 关键词列表
   */
  async function createWidget(keywords) {
    // 再次检查黑名单
    const rootDomain = getRootDomain(window.location.hostname);
    if (settings.relatedSearchBlacklist.includes(rootDomain)) {
      return;
    }

    // 【修复】检查页面 DOM 中是否已有 Shadow Host (跨实例/清理旧元素)
    const existingHost = document.getElementById('echo-related-search-host');
    if (existingHost) existingHost.remove();

    // 如果已经存在，先移除
    if (shadowHost) {
      shadowHost.remove();
    }

    // 创建 Host
    shadowHost = document.createElement('div');
    shadowHost.id = 'echo-related-search-host';
    
    // 核心修复：必须设置 fixed 定位和层级，否则组件无法浮动在页面上
    shadowHost.style.position = 'fixed';
    shadowHost.style.zIndex = '2147483647'; // Max z-index
    shadowHost.style.display = 'block';
    // 初始透明，避免闪烁
    shadowHost.style.opacity = '0';
    shadowHost.style.transition = 'opacity 0.3s ease';
    
    // 应用上次保存的位置 (Position Memory)
    // 强制修正: 仅保留 bottom 记忆，横向强制靠右
    // 注意: 保存的是逻辑像素 (100%缩放语义)，缩放补偿由 initZoomCompensation 统一处理
    let logicalBottom = BOTTOM_OFFSET_PX;
    if (settings.relatedSearchPosition && settings.relatedSearchPosition.bottom) {
        const bVal = parseInt(settings.relatedSearchPosition.bottom);
        if (!isNaN(bVal) && bVal > -50 && bVal < window.innerHeight) {
             logicalBottom = bVal;
        }
    }
    shadowHost._logicalBottom = logicalBottom;
    
    // 初始位置先用原始值，等 initZoomCompensation 统一补偿
    shadowHost.style.setProperty('--echo-bottom', `${logicalBottom}px`);
    shadowHost.style.setProperty('--echo-right', `${RIGHT_OFFSET_PX}px`);
    shadowHost.style.left = 'auto';
    shadowHost.style.top = 'auto';
    
    // 创建 Shadow DOM
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' }); // Keep closed mode
    const style = document.createElement('style');
    style.textContent = getStyles();
    shadowRoot.appendChild(style);
    
    // 创建主容器 (column-reverse: 胶囊在底部)
    container = document.createElement('div');
    container.className = 'related-search-container';
    
    // ============================================
    // 0. Peek 半圆指示器
    // ============================================
    const peekIndicator = document.createElement('div');
    peekIndicator.className = 'peek-indicator';
    
    // 感应区 (同级元素，不受 overflow:hidden 裁切)
    const peekHitarea = document.createElement('div');
    peekHitarea.className = 'peek-hitarea';
    peekHitarea.title = '点击展开搜索推荐';

    // ============================================
    // 1. 胶囊触发按钮 (保留DOM但仅作为展开态底部标识，不再作为中间态)
    // ============================================
    const trigger = document.createElement('div');
    trigger.className = 'search-trigger';
    trigger.innerHTML = `
      <span class="trigger-text">搜索推荐</span>
      <div class="toggle-indicator">${ICONS.chevronUp}</div>
    `;

    // ============================================
    // 2. 展开内容区域 (在胶囊上方)
    // ============================================
    const expandedContent = document.createElement('div');
    expandedContent.className = 'expanded-content';
    
    // 2.1 顶部控制栏 (拖拽把手 + …溢出菜单 + 收起按钮)
    const controlsRow = document.createElement('div');
    controlsRow.className = 'controls-row';
    
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle-pill';
    dragHandle.title = '按住拖动位置';
    
    // 溢出菜单按钮 (…)
    const moreBtn = document.createElement('div');
    moreBtn.className = 'more-btn';
    moreBtn.innerHTML = '⋯';
    moreBtn.title = '更多选项';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu();
    });
    
    const collapseBtn = document.createElement('div');
    collapseBtn.className = 'collapse-btn';
    collapseBtn.innerHTML = ICONS.chevronUp;
    collapseBtn.title = '收起';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapseTopeek();
    });
    
    controlsRow.appendChild(dragHandle);
    
    // 右上角按钮组
    const controlsRight = document.createElement('div');
    controlsRight.className = 'controls-right';
    controlsRight.appendChild(moreBtn);
    controlsRight.appendChild(collapseBtn);
    controlsRow.appendChild(controlsRight);
    
    // 2.2 搜索词标签容器
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'search-tags';

    /**
     * 估算字符宽度：中文=1，数字/英文/空格/标点=0.5
     */
    function getCharWidth(char) {
      // ASCII 字符（英文、数字、空格、半角标点）宽度约为中文一半
      if (char.charCodeAt(0) < 128) {
        return 0.5;
      }
      return 1;
    }

    /**
     * 计算字符串的估算宽度
     */
    function getTextWidth(text) {
      let width = 0;
      for (const char of text) {
        width += getCharWidth(char);
      }
      return width;
    }

    /**
     * 在指定宽度位置找到断点
     */
    function findBreakPoint(text, targetWidth) {
      let width = 0;
      for (let i = 0; i < text.length; i++) {
        width += getCharWidth(text[i]);
        if (width >= targetWidth) {
          return i + 1;
        }
      }
      return text.length;
    }

    /**
     * 处理文本显示：
     * - 宽度≤15：单行
     * - 宽度16-30：两行（首行=min(60%, 15)，第二行=剩余）
     * - 宽度>30：截断到30，再两行15+15
     */
    function formatKeyword(text) {
      const LINE_MAX_WIDTH = 15;
      const TWO_LINE_MAX_WIDTH = LINE_MAX_WIDTH * 2; // 30
      
      const totalWidth = getTextWidth(text);
      
      // 单行
      if (totalWidth <= LINE_MAX_WIDTH) {
        return { isTwoLine: false, displayText: text };
      }
      
      // 超长截断到30
      let processedText = text;
      let processedWidth = totalWidth;
      if (totalWidth > TWO_LINE_MAX_WIDTH) {
        const cutPoint = findBreakPoint(text, TWO_LINE_MAX_WIDTH - 1);
        processedText = text.slice(0, cutPoint) + '\u2026';
        processedWidth = getTextWidth(processedText);
      }
      
      // 两行：首行目标60%，但不超过15
      const targetFirstLineWidth = Math.min(processedWidth * 0.6, LINE_MAX_WIDTH);
      const breakPoint = findBreakPoint(processedText, targetFirstLineWidth);
      const line1 = processedText.slice(0, breakPoint);
      const line2 = processedText.slice(breakPoint);
      
      return {
        isTwoLine: true,
        line1,
        line2
      };
    }
    
    keywords.forEach(keyword => {
      const tag = document.createElement('div');
      tag.className = 'search-tag';
      
      const formatted = formatKeyword(keyword);
      
      if (formatted.isTwoLine) {
        tag.classList.add('two-line');
        tag.innerHTML = `
          ${ICONS.search}
          <span class="search-tag-text">${formatted.line1}<br>${formatted.line2}</span>
        `;
      } else {
        tag.innerHTML = `
          ${ICONS.search}
          <span class="search-tag-text">${formatted.displayText}</span>
        `;
      }
      
      tag.addEventListener('click', (e) => {
          e.stopPropagation();
          handleSearch(keyword); // 点击时使用完整关键词
      });
      tagsContainer.appendChild(tag);
    });
    
    expandedContent.appendChild(controlsRow);
    expandedContent.appendChild(tagsContainer);
    
    // ============================================
    // 3. 右键菜单
    // ============================================
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = `
      <div class="ctx-item" id="ctx-block-site">
        ${ICONS.block} <span>在此网站不再显示</span>
      </div>
      <div class="ctx-item" id="ctx-settings">
        ${ICONS.settings} <span>插件设置</span>
      </div>
    `;
    
    // 菜单功能绑定
    contextMenu.querySelector('#ctx-block-site').addEventListener('click', () => {
        addToBlacklist();
        contextMenu.classList.remove('show');
    });
    
    contextMenu.querySelector('#ctx-settings').addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options/options.html'));
        }
        contextMenu.classList.remove('show');
    });
    
    // ============================================
    // 组装 DOM
    // ============================================
    // column-reverse: peekIndicator + trigger (底部) -> expandedContent (上方)
    container.appendChild(peekIndicator);
    container.appendChild(peekHitarea);
    container.appendChild(trigger);
    container.appendChild(expandedContent);
    
    shadowRoot.appendChild(container);
    shadowRoot.appendChild(contextMenu);
    
    // ============================================
    // 4. 交互逻辑
    // ============================================
    
    // 4.1 Peek 点击 - 直接展开内容面板 (区分点击和拖拽)
    peekHitarea.addEventListener('mousedown', (e) => {
      peekMouseDownTime = Date.now();
      peekMouseDownPos = { x: e.clientX, y: e.clientY };
    });
    
    peekHitarea.addEventListener('click', (e) => {
      e.stopPropagation();
      const timeDiff = Date.now() - peekMouseDownTime;
      const posDiff = Math.abs(e.clientX - peekMouseDownPos.x) + Math.abs(e.clientY - peekMouseDownPos.y);
      if (timeDiff < 300 && posDiff < 10) {
        expandFromPeek();
      }
    });
    
    // Peek 右键菜单
    peekHitarea.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu();
    });
    
    // 胶囊点击（展开态底部胶囊） - 可点击收起
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isExpanded) {
        collapseTopeek();
      }
    });
    
    // 4.2 拖拽逻辑 - peek指示器和展开态拖拽条都可拖
    let isDragging = false;
    let startY;
    let dragStartLogicalBottom;

    /**
     * 将逻辑 bottom 值应用到 shadowHost（自动处理缩放补偿）
     * @param {number} logicalBottom - 逻辑像素值（100%缩放语义）
     */
    function applyLogicalBottom(logicalBottom) {
      shadowHost._logicalBottom = logicalBottom;
      const zoom = currentZoomLevel;
      const followZoom = settings.relatedSearchFollowZoom;
      if (followZoom || zoom === 1) {
        shadowHost.style.setProperty('--echo-bottom', `${logicalBottom}px`);
      } else {
        // CSS bottom 需要除以 zoom 来保持物理距离恒定
        // 因为: 物理距离 = CSS_bottom * zoom，要恒定 → CSS_bottom = logical / zoom
        shadowHost.style.setProperty('--echo-bottom', `${logicalBottom / zoom}px`);
      }
    }

    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isDragging = true;
      startY = e.clientY;
      // 记录拖拽开始时的逻辑 bottom
      dragStartLogicalBottom = shadowHost._logicalBottom || BOTTOM_OFFSET_PX;
      
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      
      // 鼠标 dy 是当前缩放下的 CSS 像素，转换为逻辑像素（物理像素）
      // clientY 移动 dy CSS-px = dy * zoom 物理像素，logicalBottom 就是物理像素
      const dy = e.clientY - startY;
      let newLogicalBottom = dragStartLogicalBottom - dy * currentZoomLevel;

      // 边界限制（全部用逻辑像素 = 物理像素计算）
      // 视口逻辑高度 = CSS像素 * zoom = 物理像素
      const logicalViewH = window.innerHeight * currentZoomLevel;
      
      // 上界: 预留展开空间
      const TRIGGER_HEIGHT = 32;
      const EXPAND_RESERVE = 300;
      const maxBottom = logicalViewH - TRIGGER_HEIGHT - EXPAND_RESERVE;
      
      // 下界: 留30逻辑像素，避免hover变大后超出屏幕
      const minBottom = 30;
      
      newLogicalBottom = Math.max(minBottom, Math.min(newLogicalBottom, maxBottom));
      
      // 应用（自动处理缩放补偿）
      applyLogicalBottom(newLogicalBottom);
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      
      // 保存逻辑位置 (100%缩放语义)
      const logicalBottom = shadowHost._logicalBottom || BOTTOM_OFFSET_PX;
      const finalPos = {
        right: `${RIGHT_OFFSET_PX}px`,
        bottom: `${logicalBottom}px`
      };
      settings.relatedSearchPosition = finalPos;
      chrome.storage.sync.set({ relatedSearchPosition: finalPos });
    };

    // 顶部拖拽把手
    dragHandle.addEventListener('mousedown', startDrag);
    
    // Peek hover 转发 (hitarea 是同级元素, 需手动转发 hover)
    peekHitarea.addEventListener('mouseenter', () => {
      peekIndicator.classList.add('peek-hovered');
    });
    peekHitarea.addEventListener('mouseleave', () => {
      peekIndicator.classList.remove('peek-hovered');
    });

    // Peek 竖条也可拖拽
    peekHitarea.addEventListener('mousedown', (e) => {
      startDrag(e);
    });

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    // 4.3 显示右键菜单的函数
    function showContextMenu() {
      contextMenu.classList.add('show');
      
      const closeMenu = () => {
        contextMenu.classList.remove('show');
        document.removeEventListener('click', closeMenu);
        if (shadowHost) shadowHost.removeEventListener('click', closeMenu);
      };
      
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
        if (shadowHost) shadowHost.addEventListener('click', closeMenu);
      }, 50);
    }
    
    // 4.4 展开/收起
    function expandFromPeek() {
      isExpanded = true;
      isPeek = false;
      container.classList.remove('peek');
      container.classList.remove('capsule-out');
      container.classList.add('expanded');
    }

    function collapseTopeek() {
      isExpanded = false;
      isPeek = true;
      container.classList.remove('expanded');
      container.classList.remove('capsule-out');
      container.classList.add('peek');
    }
    
    // ============================================
    // 添加到页面
    // ============================================
    document.body.appendChild(shadowHost);
    
    // 初始: 先渲染隐藏态，下一帧再添加 peek 触发进场动画
    requestAnimationFrame(() => {
      shadowHost.style.opacity = '1';
      container.classList.add('show');
      requestAnimationFrame(() => {
        container.classList.add('peek');
      });
    });

    // 初始化缩放补偿
    initZoomCompensation();
  }

  /**
   * 提取根域名 (Root Domain)
   */
  function getRootDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    const secondLast = parts[parts.length - 2];
    const last = parts[parts.length - 1];
    if (['com', 'co', 'org', 'net', 'edu', 'gov'].includes(secondLast) && last.length === 2) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  /**
   * 添加当前网站到黑名单 (带撤销功能)
   */
  function addToBlacklist() {
    const rootDomain = getRootDomain(window.location.hostname);
    
    if (!settings.relatedSearchBlacklist.includes(rootDomain)) {
      // 1. 立即添加到本地设置
      settings.relatedSearchBlacklist.push(rootDomain);
      chrome.storage.sync.set({ relatedSearchBlacklist: settings.relatedSearchBlacklist });
      
      // 2. 隐藏主界面，显示 Snackbar
      if (container) container.style.display = 'none';
      showSnackbar(`不再显示 - ${rootDomain}`, () => {
        // 撤销操作
        settings.relatedSearchBlacklist = settings.relatedSearchBlacklist.filter(d => d !== rootDomain);
        chrome.storage.sync.set({ relatedSearchBlacklist: settings.relatedSearchBlacklist });
        
        // 恢复界面
        if (container) container.style.display = 'flex';
      }, () => {
        // 彻底移除 (Timeout 后)
        if (shadowHost) shadowHost.remove();
      });
    }
  }
  
  /**
   * 显示 Snackbar 通知
   */
  function showSnackbar(message, onUndo, onDismiss) {
    if (!shadowRoot) return;
    
    const old = shadowRoot.querySelector('.echo-snackbar');
    if (old) old.remove();
    
    const snackbar = document.createElement('div');
    snackbar.className = 'echo-snackbar';
    snackbar.innerHTML = `
      <span>${message}</span>
      <span class="echo-snackbar-btn">撤销</span>
    `;
    
    const undoBtn = snackbar.querySelector('.echo-snackbar-btn');
    let isUndone = false;
    
    undoBtn.addEventListener('click', () => {
        isUndone = true;
        snackbar.classList.remove('show');
        setTimeout(() => snackbar.remove(), 300);
        if (onUndo) onUndo();
    });
    
    shadowRoot.appendChild(snackbar);
    
    requestAnimationFrame(() => snackbar.classList.add('show'));
    
    setTimeout(() => {
        if (!isUndone) {
            snackbar.classList.remove('show');
            setTimeout(() => {
                snackbar.remove();
                if (onDismiss) onDismiss();
            }, 300);
        }
    }, 4000);
  }

  /**
   * 暂时隐藏 Widget (本页有效)
   */
  function hideWidgetTemporarily() {
    if (shadowHost) {
      shadowHost.style.display = 'none';
    }
  }

  function handleSearch(keyword) {
    // 在后台新标签页中打开 Bing 搜索，带 ECHORR 追踪参数
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}&FORM=ECHORR`;
    
    // 发送消息到 background 打开后台标签
    chrome.runtime.sendMessage({
      action: 'openInNewTab',
      url: searchUrl,
      active: false  // 后台打开
    });
  }

  // ============================================
  // 主流程控制
  // ============================================


  /**
   * 加载并尝试显示相关搜索
   * 核心原则：Silent Fail (失败时不打扰用户)
   */
  async function loadAndShow() {
    // 1. 静默提取 (无Loading UI)
    const keywords = await extractKeywords();
    
    // 2. 质量校验 - 只要有 2 个及以上的关键词就显示
    if (!keywords || keywords.length < 2) {
      return; 
    }
    
    // 3. 只有成功提取到了足够的关键词，才渲染 UI
    createWidget(keywords);
  }

  /**
   * 初始化入口
   */
  function init() {
    // 检查黑名单 (早退)
    if (settings.relatedSearchBlacklist.some(domain => window.location.hostname.includes(domain))) {
      return;
    }

    // 等待页面加载完成 (Interactive 即可开始分析，不需要完全 Load)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // 延迟一点点，避开页面初始化高负载
        setTimeout(loadAndShow, 1000);
      });
    } else {
      setTimeout(loadAndShow, 1000);
    }
  }

  init();

})();