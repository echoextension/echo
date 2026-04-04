"""
fetch_videos.py — B站歪脖子视频候选爬取脚本

功能：
- 从舞蹈区(rid=20) + vlog区(rid=163) 各爬取指定数量视频
- 通过 dimension.rotate == 1 识别被旋转90°的歪脖子视频
- 输出结果到 candidates.json
"""

import requests
import json
import time

# ========== 配置 ==========
REGIONS = [
    {"name": "舞蹈区", "rid": 20},
    {"name": "vlog区", "rid": 163},
]
VIDEOS_PER_REGION = 50   # 每个分区爬取数量
PAGE_SIZE = 20           # 每页请求数量
REQUEST_INTERVAL = 1     # 请求间隔（秒）
OUTPUT_FILE = "candidates.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
}

# ========== 工具函数 ==========

def fetch_newlist(rid: int, pn: int, ps: int = PAGE_SIZE) -> list:
    """拉取分区最新视频列表"""
    url = "https://api.bilibili.com/x/web-interface/newlist"
    params = {"rid": rid, "pn": pn, "ps": ps}
    resp = requests.get(url, params=params, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        print(f"  [WARN] API 返回错误: {data.get('message')}")
        return []
    return data.get("data", {}).get("archives", [])


# ========== 主流程 ==========

def main():
    all_candidates = []
    total_checked = 0

    for region in REGIONS:
        rid = region["rid"]
        name = region["name"]
        print(f"\n=== 开始爬取 {name} (rid={rid}) ===")

        collected = 0
        page = 1

        while collected < VIDEOS_PER_REGION:
            batch_size = min(PAGE_SIZE, VIDEOS_PER_REGION - collected)
            print(f"  拉取第 {page} 页（目标 {batch_size} 条）...")
            try:
                archives = fetch_newlist(rid, pn=page, ps=batch_size)
            except Exception as e:
                print(f"  [ERROR] 拉取失败: {e}")
                break

            if not archives:
                print("  无更多数据，停止")
                break

            for item in archives:
                bvid = item.get("bvid", "")
                title = item.get("title", "")
                pic = item.get("pic", "").replace("http://", "https://")
                play = item.get("stat", {}).get("view", 0)
                like = item.get("stat", {}).get("like", 0)

                dimension = item.get("dimension", {})
                rotate = dimension.get("rotate", 0)
                dim_w = dimension.get("width", 0)
                dim_h = dimension.get("height", 0)

                total_checked += 1
                is_candidate = rotate == 1
                print(f"  [{total_checked}] {bvid} | rotate={rotate} dim={dim_w}x{dim_h} | "
                      f"{'✅ 歪脖子！' if is_candidate else '正常'} | {title[:20]}")

                if is_candidate:
                    all_candidates.append({
                        "title": title,
                        "bvid": bvid,
                        "url": f"https://www.bilibili.com/video/{bvid}",
                        "cover_url": pic,
                        "rotate": rotate,
                        "dimension": {"width": dim_w, "height": dim_h},
                        "play": play,
                        "like": like,
                        "region": name,
                    })

                time.sleep(REQUEST_INTERVAL)

            collected += len(archives)
            page += 1
            time.sleep(REQUEST_INTERVAL)

    # 按播放量排序
    all_candidates.sort(key=lambda x: x["play"], reverse=True)

    print(f"\n=== 完成 ===")
    print(f"共检查 {total_checked} 条视频，发现 {len(all_candidates)} 条歪脖子候选")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_candidates, f, ensure_ascii=False, indent=2)
    print(f"结果已保存到 {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
