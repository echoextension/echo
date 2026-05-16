# wallpaper-data.json 维护规范

## 数据源与致谢

壁纸历史数据来源及深切感谢：https://github.com/niumoo/bing-wallpaper

原始仓库许可证：Apache License 2.0（https://github.com/niumoo/bing-wallpaper/blob/main/LICENSE.md）

使用方式：基于原始仓库的壁纸归档数据，提取 ID、日期、描述、版权信息，整理为 JSON 静态数组格式。

## 图片 URL 构建规则

- 4K: `https://cn.bing.com/th?id=OHR.{id}_UHD.jpg&rf=LaDigue_UHD.jpg&pid=hp&w=3840&h=2160&rs=1&c=4`
- 1080P: `https://cn.bing.com/th?id=OHR.{id}_UHD.jpg&pid=hp&w=1920&h=1080&rs=1&c=4`

## 追加新条目的约定

### 1. 唯一数据源

上述 niumoo 仓库的 **zh-cn 目录**（中文版原生文案）。

- **ID 首选来源**：`zh-cn/picture/YYYY-MM/README.md`
  （月度汇总表格，每格都带完整 OHR 图片 URL，结构规整不易错位）
- **描述/版权来源**：`zh-cn/bing-wallpaper.md`

不要使用其它镜像或聚合站点，也不要把 en-us 的文案翻译过来充当中文描述。
注意 zh-cn 版本与 en-us 通常有 1 天时差，请以 zh-cn 的日期标注为准。

### 2. 字段格式

```json
{ "id": "Xxx_ZH-CN1234567890", "date": "YYYY-MM-DD", "desc": "中文描述", "copyright": "© 版权信息" }
```

- `id`：取 `OHR.{id}_UHD.jpg` 中的 `{id}` 部分（形如 `Xxx_ZH-CN1234567890`）
- `desc` 和 `copyright` 直接采用原始仓库中的中文描述与署名，不做再加工

### 3. 排序

数组整体按日期从新到旧排列。

### 4. 远端文件注意事项

远端 `bing-wallpaper.md` 文件较大，一次抓取可能按相关度分段并省略。
若发现目标日期的条目缺失或描述不完整，请带上日期/ID 关键字再请求同一个 raw URL，而不是改用其它来源。务必按"N 天对应 N 条"核查完整性，不要用相邻日期的 ID 凑数。

### 5. 落库前自检

- 批量检查 `id` 字段两两不重复
- 对每条新 `id` 做一次 HEAD 请求：`https://cn.bing.com/th?id=OHR.{id}_UHD.jpg` 必须返回 200 image/jpeg

### 6. 上游纠错

若上游偶发笔误（例如相邻两天 ID 重复、版权串多余括号等），以 `cn.bing.com` 实际可访问的 OHR 图片 URL 为准进行修正，并保留对上游仓库的致谢与许可证声明。
