# mentorclaw 课程接口架构草案

## 1. 这份文档的作用

这份文档不是顶层重构计划。

它只回答一个问题：

**当 mentorclaw 的顶层对象已经收束为 `project / cron` 后，project 如何接入校内课程资源。**

这样做的目的，是把“课程接口设计”从“顶层重构计划”里拆出去，降低认知负担。

## 2. 当前已存在的能力

当前仓库已经有一套课程数据真相源：

- [src/storage/education-repo.ts](/home/jiaxu/mentorclaw-source/src/storage/education-repo.ts)
- [src/schemas/education.ts](/home/jiaxu/mentorclaw-source/src/schemas/education.ts)
- [src/education/query.ts](/home/jiaxu/mentorclaw-source/src/education/query.ts)

运行时数据位于：

```text
workspace/state/education/
```

核心文件：

- `courses.json`
- `course-items.json`
- `course-resources.json`

这层已经能表达：

- 课程主体
- class / assignment / exam / notice / replay
- ppt / pptx / pdf / video / subtitle / notes / link

所以后续不应复制课程数据，只应在 `project` 层做绑定。

## 3. 课程接口的总原则

### 3.1 不复制实体，只保存绑定关系

`project` 不复制课程资源完整内容。

`project` 只应保存：

- 绑定了哪些课程
- 偏好使用哪些资源类型
- 人工钉住了哪些资源

课程实体和资源实体继续保留在 `state/education/*`。

### 3.2 资源检索是查询层，不是记忆层

课程资源不应该被整体抄进 memory 文件。  
正确方式是：

- 记忆层保存稳定用户画像
- project 保存绑定关系与执行状态
- 需要回答时临时查询课程资源

### 3.3 查询结果只给本轮所需最小上下文

系统不该把整门课所有资源塞进 prompt。  
它应该只返回：

- 与当前问题最相关的 class / replay / assignment / resource
- 对回答真正有帮助的极少量事实

## 4. 建议的 project 绑定结构

`projects/<projectId>.yaml` 中建议包含一段课程绑定：

```yaml
scope:
  type: course
  courseIds:
    - course-xxx

resources:
  pinnedResourceIds: []
  preferredTypes:
    - ppt
    - subtitle
    - notes
```

解释：

- `scope.courseIds`
  这个 project 工作在哪些课程内
- `pinnedResourceIds`
  某些人工钉住、始终优先考虑的资源
- `preferredTypes`
  默认优先使用哪些资源类型

## 5. 课程接口未来应提供的能力

建议新增一个很薄的桥接服务，例如：

```text
src/education/project-resource-service.ts
```

它只负责三件事：

1. 根据 `project.scope.courseIds` 找到课程范围
2. 根据问题和上下文筛选相关 `course-items` / `course-resources`
3. 返回一个极简结果给 orchestrator

它不负责：

- 维护用户画像
- 维护 project 状态
- 维护 prompt 主干

## 6. 未来接口能力分层

### 6.1 基础查询能力

- 列出 project 绑定课程
- 列出某课程最近的 class / assignment / replay
- 列出某课程的资源

### 6.2 面向回答的检索能力

- 找“最近一次讲某知识点”的 replay / subtitle / ppt
- 找“当前课程未完成作业”
- 找“即将到来的考试/课程事件”

### 6.3 面向 cron 的查询能力

- 找“刚结束的一节课”
- 找“明天有课/有作业的课程”
- 找“本周更新最多的课程资源”

## 7. 典型场景

### 场景 A：老师是怎么讲某个知识点的

用户在某个课程 project 中问：

“老师第 5 讲怎么讲卷积的？”

理想流程：

1. session 绑定到 project
2. project 绑定到课程
3. 查询该课程下与“第 5 讲 / 卷积”相关的 replay、subtitle、ppt
4. 返回给模型极少量相关事实或片段
5. 模型作答

### 场景 B：问这节课作业是什么

用户在课程 project 中问：

“这节课作业是什么？”

理想流程：

1. 找 project 绑定课程
2. 查 `course-items.json` 中相关 assignment / notice
3. 必要时补相关资源
4. 模型回答并整理成清晰的待办

### 场景 C：课后总结 cron

cron 触发：

“本节课结束后总结重点内容和待补概念。”

理想流程：

1. cron 绑定课程
2. 取最近一次 class / replay
3. 取该节课对应 subtitle / ppt / notes
4. 组织总结

## 8. 暂不在本轮展开的内容

为了避免顶层计划过重，这一轮先不落实以下细节：

- 课程资源排序算法
- 资源相关度评分
- 字幕分段切片
- 引用权限与缓存规则
- 资源摘要生成策略
- 资源缺失时的降级路径

这些在正式实施课程接口时再单独细化。

## 9. 和顶层重构计划的关系

这份文档依赖于以下前提：

1. 顶层对象已收束为 `project / cron`
2. `thread` 已废弃
3. 全局记忆已回归 `MEMORY.md`
4. project 已成为唯一业务状态真相源

也就是说：

**课程接口不是顶层设计的起点，而是顶层设计稳定后再接入的一层桥。**
