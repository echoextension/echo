"""
generate_report.py — 歪脖子视频候选 HTML 报告生成脚本

功能：
- 读取 candidates.json
- 生成包含封面缩略图、标题、播放量、视频链接的 HTML 报告
- 输出到 report.html
"""

import json
import os
from datetime import datetime

INPUT_FILE = "candidates.json"
OUTPUT_FILE = "report.html"


def format_play(n: int) -> str:
    """格式化播放量数字"""
    if n >= 10000:
        return f"{n / 10000:.1f}万"
    return str(n)


def generate_html(candidates: list) -> str:
    total = len(candidates)
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 按分区统计
    region_counts = {}
    for c in candidates:
        r = c.get("region", "未知")
        region_counts[r] = region_counts.get(r, 0) + 1
    region_summary = "　".join(f"{k}: {v} 条" for k, v in region_counts.items())

    # 生成视频卡片
    cards_html = ""
    for item in candidates:
        title = item.get("title", "")
        bvid = item.get("bvid", "")
        url = item.get("url", f"https://www.bilibili.com/video/{bvid}")
        cover_url = item.get("cover_url", "")
        rotate = item.get("rotate", 1)
        dimension = item.get("dimension", {})
        dim_str = f"{dimension.get('width',0)}x{dimension.get('height',0)}" if dimension else ""
        play = format_play(item.get("play", 0))
        like = format_play(item.get("like", 0))
        region = item.get("region", "")

        cards_html += f"""
        <div class="card">
            <a href="{url}" target="_blank" class="cover-link">
                <img src="{cover_url}" alt="{title}" class="cover" loading="lazy" onerror="this.src='https://via.placeholder.com/120x160?text=No+Image'">
            </a>
            <div class="info">
                <a href="{url}" target="_blank" class="title">{title}</a>
                <div class="meta">
                    <span class="tag region">{region}</span>
                    <span class="tag ratio">rotate={rotate} {dim_str}</span>
                </div>
                <div class="stats">
                    <span>▶ {play}</span>
                    <span>👍 {like}</span>
                    <span class="bvid">{bvid}</span>
                </div>
            </div>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>B站歪脖子视频候选报告</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f4f5f7;
            color: #333;
            padding: 24px;
        }}
        .header {{
            background: linear-gradient(135deg, #fb7299, #e04b7a);
            color: white;
            border-radius: 12px;
            padding: 24px 28px;
            margin-bottom: 24px;
        }}
        .header h1 {{ font-size: 22px; margin-bottom: 8px; }}
        .header .summary {{ font-size: 14px; opacity: 0.9; }}
        .grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
            gap: 16px;
        }}
        .card {{
            background: white;
            border-radius: 10px;
            padding: 14px;
            display: flex;
            gap: 14px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
            transition: box-shadow 0.2s;
        }}
        .card:hover {{ box-shadow: 0 4px 16px rgba(0,0,0,0.12); }}
        .cover-link {{ flex-shrink: 0; }}
        .cover {{
            width: 90px;
            height: 120px;
            object-fit: cover;
            border-radius: 6px;
            display: block;
        }}
        .info {{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }}
        .title {{
            font-size: 14px;
            font-weight: 600;
            color: #1a1a1a;
            text-decoration: none;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.4;
        }}
        .title:hover {{ color: #fb7299; }}
        .meta {{ display: flex; gap: 6px; flex-wrap: wrap; }}
        .tag {{
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 4px;
            font-weight: 500;
        }}
        .region {{ background: #fff0f4; color: #e04b7a; }}
        .ratio {{ background: #f0f4ff; color: #3366cc; }}
        .stats {{ font-size: 12px; color: #888; display: flex; gap: 12px; align-items: center; }}
        .bvid {{ color: #bbb; font-size: 11px; }}
        .empty {{ text-align: center; padding: 60px; color: #999; font-size: 16px; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🦒 B站歪脖子视频候选报告</h1>
        <div class="summary">
            共发现 <strong>{total}</strong> 条候选视频（宽高比 &lt; 0.75）　{region_summary}
            <br>生成时间：{generated_at}
        </div>
    </div>
    {"<div class='grid'>" + cards_html + "</div>" if candidates else "<div class='empty'>暂无候选视频</div>"}
</body>
</html>"""
    return html


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"[ERROR] 找不到 {INPUT_FILE}，请先运行 fetch_videos.py")
        return

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        candidates = json.load(f)

    print(f"读取到 {len(candidates)} 条候选视频")

    html = generate_html(candidates)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"报告已生成：{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
