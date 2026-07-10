<p align="center">
  <img src="docs/assets/cover.png" alt="Loop-Engineering" width="720">
</p>

# Loop-Engineering

面向 AI 编程代理的可移植循环工程协议与工具集。

Loop-Engineering 把周期性代理工作变成明确、可审查的循环：

```text
目标 -> 发现 -> 交接 -> 验证 -> 持久化 -> 调度 -> 下一轮运行
```

本项目不绑定任何特定代理。Codex、Claude Code、ChatGPT、OpenClaw 和自定义执行框架都只是同一份循环规范之上的轻量适配层。

## 当前版本：v0.1.0

`v0.1.0` 是首个可实际使用的早期版本：核心协议、校验、状态管理、运行记录和适配器渲染已经可用，但长期运行的 Runner 尚未实现，公开 API 也还不承诺完全稳定。

规范中的 `apiVersion: loop-engineering/v1` 表示**协议格式版本**，不代表产品已经进入 v1.0.0。

## 为什么需要它

循环工程正在取代逐轮手动提示：你不再一轮一轮地驱动代理，而是设计驱动代理的循环——发现、交接、验证、持久化和调度。循环层位于提示词、上下文和执行框架之上，详见 [docs/positioning.md](docs/positioning.md)。

目前很多循环仍然存在于自然语言说明和个人脚本中。它们足以支持一个人完成一次运行，但周期性、无人值守的工作需要更强的契约：

- 循环要推进什么目标？
- 它如何发现有明确边界的工作？
- 谁负责执行？
- 谁负责独立验证？
- 对话结束后，状态保存在哪里？
- 哪些预算、重试和人工审核门槛能够阻止不安全的自动化？

Loop-Engineering 将这些答案明确写入 `loop.yaml`。

## v0.1.0 已实现能力

- 定义可移植的 `loop.yaml` 协议。
- 使用 JSON Schema 和额外安全规则校验循环规范。
- 初始化带持久状态的循环目录。
- 机械化规划运行：`loopctl next` 读取状态和预算，判断本轮是否可以执行以及最多处理多少工作。
- 机械化记录运行：`loopctl record` 校验运行日志、归档日志并更新状态，不需要手工编辑 JSON。
- 使用 `loopctl check` 检查任意协议产物。
- 为 Codex、Claude Code、ChatGPT、OpenClaw 和通用执行框架生成适配器；其中 ChatGPT 是只负责设计与审查的顾问型适配器。
- 提供 CI 故障分诊、依赖更新和前端质量检查的完整示例。

## 后续方向：Runner

当前版本可以定义、校验、初始化、渲染和规划循环，也可以通过 `record` 记录结果，但每一轮仍需由外部代理或调度系统发起并执行。后续计划引入长期运行的 `loopd`：持续扫描 `.loop-engineering/loops`、调度到期循环、获取租约、执行一次有明确边界的迭代、写入运行日志、强制执行预算，并在人工审核门槛处停止。

这只是后续方向，目前不绑定新的主版本号。

## 快速开始

```bash
npm install
node ./bin/loopctl.js validate examples/ci-triage/loop.yaml
node ./bin/loopctl.js doctor
node ./bin/loopctl.js init ci-triage --from examples/ci-triage/loop.yaml --out .loop-engineering/loops
node ./bin/loopctl.js render codex examples/ci-triage/loop.yaml --out /tmp/ci-triage-codex

# 运行前：本轮是否允许执行？最多可以处理多少工作？
node ./bin/loopctl.js next .loop-engineering/loops/ci-triage

# 运行后：归档运行日志，并在同一步骤中更新状态
node ./bin/loopctl.js record .loop-engineering/loops/ci-triage --run run-log.json
```

## 核心契约

一份有效的循环规范必须定义：

- `goal`：目标、验收条件、停止条件和阻塞条件。
- `discovery`：有明确边界的发现来源与排序策略。
- `handoff`：隔离执行的工作者契约。
- `verification`：独立评估器契约与必要证据。
- `persistence`：位于对话之外的状态和运行日志路径。
- `schedule`：运行环境、执行频率、超时和并发行为。
- `safety`：预算限制、重试限制和人工审核门槛。

如果规范缺少独立验证、持久化、预算，或者没有为高风险操作设置仅限人工的门槛，校验器会直接拒绝该规范。

## 命令

```bash
loopctl validate <loop.yaml...>
loopctl init <loop-name> --from <loop.yaml> --out .loop-engineering/loops
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl check <loop|state|evaluator|run-log> <file...>
loopctl schema <loop|state|evaluator|run-log>
loopctl doctor
```

`next` 输出一份 JSON 计划，其中包括：循环是否允许运行（每日运行次数预算与 UTC 日期切换）、本轮工作项上限、重试队列、已耗尽重试次数的工作项，以及仍待人工处理的工作项。当循环不应运行时，该命令会以非零状态退出，调度器可以据此阻止后续执行。

`record` 根据协议 Schema 校验运行日志；当 `results` 数量超过 `maxItemsPerRun` 时拒绝写入。它会根据当前状态和本次日志生成下一份状态，完成 Schema 校验后，再依次写入运行日志和 `state.json`。

v0.1.0 支持以下渲染适配器：

- `codex`
- `claude-code`
- `chatgpt`
- `openclaw`
- `generic-harness`
- `github-actions`

## 仓库结构

```text
protocol/       循环规范与持久状态的 JSON Schema
src/            CLI 实现
templates/      可复用的循环模板
adapters/       轻量代理适配器模板
examples/       通过校验的循环示例
test/           Node 冒烟测试与校验测试
docs/           项目设计文档
```

## 安全模型

生成器决定可以产出什么，评估器决定什么不能通过。

v0.1.0 要求使用独立评估器，并为合并、部署、删除生产数据、花费资金或修改权限等高风险操作设置仅限人工的门槛。

需要明确当前版本的执行边界：校验器会拒绝不安全的规范，`next` 和 `record` 会机械化执行预算与状态格式约束，但门槛本身仍然是给执行代理的指令，并不是沙箱。当前版本无法从物理层面阻止行为异常的代理执行合并或部署。运行时强制执行这些约束属于后续 Runner 的职责；在此之前，应把生成的技能视为代理必须遵守的契约，并避免向无人值守的循环提供高风险凭据。

## 示例

```yaml
apiVersion: loop-engineering/v1
kind: Loop
metadata:
  name: ci-triage
goal:
  objective: "发现反复失败的 CI 运行、起草修复方案，并在 PR 审核前独立验证，从而减少重复出现的 CI 故障。"
verification:
  evaluator: ci-fix-evaluator
  independent: true
  defaultStance: assume-broken
```

完整规范见 [examples/ci-triage/loop.yaml](examples/ci-triage/loop.yaml)。

## 开发

```bash
npm install
npm run smoke
npm pack --dry-run
```

`adapters/` 下的文件由 `src/skill-content.js` 统一生成，渲染器也使用同一份来源。修改技能内容后，请运行 `npm run build:adapters`；如果生成文件与来源不一致，`loopctl doctor` 会失败。

更多文档：

- [产品定位：Loop-Engineering](docs/positioning.md)
- [协议](docs/protocol.md)
- [适配器](docs/adapters.md)
- [Runner 设计](docs/runner-design.md)
- [架构](docs/architecture.md)
- [v0.1.0 目标](docs/v0.1-goals.md)
- [发布检查清单](docs/publish-checklist.md)
- [路线图](docs/roadmap.md)
