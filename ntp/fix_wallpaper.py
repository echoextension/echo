path = '/home/ubuntu/.openclaw/workspace-fte-pm/projects/echo/ntp/wallpaper-data.js'
with open(path, encoding='utf-8') as f:
    lines = f.readlines()

# 行21-50（0-indexed: 20-49）是多余的重复区块，直接删除
# 验证边界
print('删除前第20行:', repr(lines[20]))
print('删除前第50行:', repr(lines[50]))

new_lines = lines[:20] + lines[50:]

# 验证
print('修复后第20行:', repr(new_lines[20]))

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('完成，总行数:', len(new_lines))

# 验证无重复
import re
content = ''.join(new_lines)
dates = re.findall(r'date: "([\d-]+)"', content)
from collections import Counter
dups = [d for d,c in Counter(dates).items() if c > 1]
print('重复日期:', dups if dups else '无')
