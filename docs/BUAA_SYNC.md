# 北航同步说明

这份文档只回答 5 个问题：

1. `BYXT` 和 `MSA` 各自负责什么  
2. 为什么不能只用一个平台  
3. mentorclaw 现在真正同步了什么  
4. 数据写到哪里  
5. 如何核对同步结果是否正确

## 一句话结论

- `BYXT` 负责“你这学期到底上什么课、什么时候上”
- `MSA` 负责“某门已知课程有没有回放、视频、PPT”

如果只看课表，`BYXT` 就够。  
如果要做课程回放、字幕、PPT、知识点切片，`MSA` 不能省。

所以最小可维护方案不是“两边都当主数据源”，而是：

- `BYXT` 作为课程主表和课表真相
- `MSA` 只给已经在课表里的课程补资源

## 为什么不用一个平台全包

### 只用 `BYXT` 的问题

`BYXT` 的优势：

- 课程名单稳定
- 周次、上课时间、地点完整
- 最适合生成 `schedule`

`BYXT` 的缺点：

- 不提供课程回放资产主链路
- 不适合拿字幕、PPT、视频

结论：

- 如果 mentorclaw 只需要知道“今天上什么课”，只用 `BYXT` 可以
- 如果 mentorclaw 后面要支持“调出这节课的回放/PPT/字幕”，只用 `BYXT` 不够

### 只用 `MSA` 的问题

`MSA` 的优势：

- 有回放
- 有视频
- 有 PPT 相关接口
- 后续可以接 livingroom 字幕/PPT 捕获

`MSA` 的缺点：

- 不适合作为“我这学期课程主表”的唯一来源
- 平台里会混入公共课程、最近访问课程、资源广场课程
- 不保证和你真实课表严格一致

结论：

- `MSA` 不能作为课程主数据源
- 它只能做课程资源补充源

## 现在的真实规则

现在代码已经收敛成下面这条规则：

- `BYXT` 导入课表，生成课程和 `class`
- `MSA` 只有在“课程标题/教师能匹配到已有 `BYXT` 课程”时才允许导入
- 匹配不到就直接跳过，不会单独建一门新课

这就是为什么你说“只关注课表里的课程”后，我把 `MSA` 收紧了。

## 我这次为什么会导入 `行政诉讼法`

这是我前一轮的错误判断，不是你的数据事实。

当时我用的是 `MSA` 的“最近访问课程”入口，它返回的是你账号最近在 `MSA` 里出现过的课程，不等于你当前课表。  
所以 `行政诉讼法` 虽然能从 `MSA` 拿到回放，但它不在你当前 `BYXT` 课表里，就不该进入 mentorclaw 的主课程集。

现在已经修成：

- `MSA` 课程如果不在 `BYXT` 课表里，直接跳过

## 当前实现了哪些同步

### `BYXT`

代码位置：

- [byxt.ts](/home/jiaxu/mentorclaw-source/src/education/providers/buaa/byxt.ts)

当前会同步：

- 学期
- 周次
- 每周课表
- 课程名
- 教师
- 地点
- 上下课时间

最终写入：

- `courses.json`
- `course-items.json` 中的 `type=class`

### `MSA`

代码位置：

- [msa.ts](/home/jiaxu/mentorclaw-source/src/education/providers/buaa/msa.ts)

当前会同步：

- 某门已知课程的 replay 条目
- replay 对应的视频
- replay 对应的 PPT 资源

最终写入：

- `course-items.json` 中的 `type=replay`
- `course-resources.json`

### livingroom 捕获导入

代码位置：

- [msa.ts](/home/jiaxu/mentorclaw-source/src/education/providers/buaa/msa.ts)
- [import-buaa-livingroom-json.ts](/home/jiaxu/mentorclaw-source/scripts/import-buaa-livingroom-json.ts)

它不是主同步器，而是“把浏览器里已经抓到的字幕/PPT 数据导入本地存储”的桥接工具。

## 数据现在写到哪里

当前唯一活动 runtime 是 WSL 这套：

```text
\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\
```

教育数据在这里：

- `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\connections.json`
- `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\courses.json`
- `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\course-items.json`
- `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\course-resources.json`
- `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\schedule-preferences.json`

这几个文件是本地 runtime 数据，不属于 source repo。

所以：

- 同步器代码可以进仓库
- 你的真实课表和连接信息不能进仓库

## 如何核对同步结果

最可靠的核对方法不是看日志，而是直接看 runtime 文件。

真实数据优先看 WSL runtime，不要再看 Windows 那套旧副本。

## 怎么看导入是否正确

优先按下面顺序核对：

1. `courses.json`
   - 看课程名、教师、学期是否和你的真实课表一致
2. `course-items.json`
   - 先看 `type=class`
   - 再看时间、地点、教师是否正确
3. `schedule`
   - 打开“显示课表”，看周视图里是否和课表一致
4. `course-resources.json`
   - 只在确认某门课确实属于你之后，再看 replay / 视频 / PPT 是否绑定正确

## 相关脚本

### 同步课表

```bash
npm run sync:buaa:byxt -- --cookie-file path/to/byxt-cookie.txt
```

### 同步某门 MSA 课程资源

```bash
npm run sync:buaa:msa -- --cookie-file path/to/msa-cookie.txt --course-id 12345
```

注意：

- `MSA` 现在只会导入能匹配到已有 `BYXT` 课表课程的内容

## 设计原则

整个实现只坚持一个原则：

- 课程主集只能来自课表真相源
- 资源源只能补充，不允许反过来污染课程主集

这样 mentorclaw 才不会因为资源平台里的噪声课程，把学生画像带偏。
