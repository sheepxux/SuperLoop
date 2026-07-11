<p align="center">
  <img src="docs/assets/cover.png" alt="Loop-Engineering" width="720">
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

# Loop-Engineering

一个可安装的高级 Agent Skill，以及支撑它运行的本地参考运行时。

Loop-Engineering 用明确、可审计的工程契约管理周期性 Agent 工作：

```text
适用性判断 → 目标 → 发现 → 隔离交接 → 独立验证 → 持久化 → 调度 → 下一轮
                                           ↓
                             匹配基准 → 策略晋级或回滚
```

它的第一身份是 `skills/loop-engineering` 下的完整 Skill；`loopctl`、`loopd`、协议 Schema 和平台插件是 Skill 的确定性执行底座。

## 当前版本：v1.0.1

`v1.0.1` 是完整 Skill-first v1 的当前补丁版本：提供一份 Codex 与 Claude Code 共用的 canonical Skill、渐进式 references、自包含模板、真实行为评测集、双平台插件清单，以及受证据约束的本地 Runner 和任务策略进化机制；同时修正了 Claude Code marketplace 的严格清单加载兼容性。

这里的“进化”是**基准驱动的任务策略优化**，不是修改模型权重，也不是让 Agent 自主削弱安全约束。

## 它会做什么

Skill 首先把请求分成四类：

- `one-shot`：直接完成，不创建循环。
- `deterministic`：优先使用脚本、CI 或 cron。
- `agentic-loop`：为需要周期性判断和修复的任务设计循环。
- `unsafe-loop`：加入人工门槛，或拒绝无人值守执行。

对于适合循环化的任务，它支持七种工作模式：评估、设计、脚手架、运行、审查、恢复和策略进化。

## v1.0 的完整能力

- 标准 Agent Skills 目录：`SKILL.md`、`agents/openai.yaml`、`references/`、`scripts/`、`assets/` 和 `evals/`。
- 一份 canonical Skill 同时服务 Codex 与 Claude Code，避免多份正文漂移。
- Codex 和 Claude Code 插件/marketplace 清单，以及 source/npm 安装回退。
- 可移植的 `loop.yaml` 协议和 JSON Schema 安全校验。
- 持久状态、运行计划、暂停/恢复、重试队列、人工收件箱和审计日志。
- 每个任务结果必须绑定独立 evaluator artifact、context ID 和 SHA-256；空结果不能伪装成功。
- 条目、单次时长、每日运行次数和单次成本预算会机械拒绝超限记录。
- `dry-run` 是观测状态，不计入真实任务成功率、预算或策略进化指标。
- 本地 `loopd` Runner、原子文件租约、超时、事件流和独立运行目录。
- 固定 benchmark manifest、匹配 case IDs、逐例结果与证据摘要的策略实验。
- 聚合分数由逐例结果机械重算，不能只提交自报分数。
- 人工批准绑定已暂存实验的 SHA-256；候选被替换后批准自动失效。
- 所有策略版本归档；回滚会恢复旧行为并生成新的单调版本，不改写历史。
- Codex/Claude 的每循环实例 Skill、ChatGPT 顾问说明、OpenClaw 与通用 harness 适配器。
- GitHub Actions 只生成明确标注的只读 preflight scaffold，不冒充完整执行器。

## 安装 Skill

### 使用 GitHub Skill（推荐，当前为 GitHub CLI 预览能力）

```bash
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.1 --agent codex
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.1 --agent claude-code
```

### Codex 插件

```text
codex plugin marketplace add sheepxux/Loop-Engineering --ref v1.0.1
codex plugin add loop-engineering@loop-engineering
```

### Claude Code 插件

```text
claude plugin marketplace add sheepxux/Loop-Engineering
claude plugin install loop-engineering@loop-engineering
```

### 从源码安装并验证

```bash
git clone --branch v1.0.1 https://github.com/sheepxux/Loop-Engineering.git
cd Loop-Engineering
npm ci
node ./bin/loopctl.js skill validate

# 项目级安装；使用 --scope user 可安装到用户目录
node ./bin/loopctl.js skill install both --scope project
```

发布者完成可选的 npm registry 发布后，也可以使用：

```bash
npm install --global @sheepxux/loop-engineering@1.0.1
loopctl skill install both --scope user
```

## 快速开始

```bash
# 检查 Skill、Schema、插件元数据和生成文件是否一致
loopctl doctor
loopctl skill validate

# 使用 Skill 自带的安全 dry-run 模板初始化一个循环
loopctl init quickstart --out .loop-engineering/loops

# 运行前机械检查预算、重试和人工门槛
loopctl next .loop-engineering/loops/quickstart

# 为具体循环生成平台实例 Skill
loopctl render codex .loop-engineering/loops/quickstart/loop.yaml --out .
loopctl render claude-code .loop-engineering/loops/quickstart/loop.yaml --out .

# 安全测试 Runner；不会计入任务成功或进化指标
loopd start --once --loop quickstart
```

Codex 实例写入 `.agents/skills/<loop-name>/`；Claude Code 实例写入 `.claude/skills/<loop-name>/`。它们是具体循环的执行入口，不会覆盖 canonical `loop-engineering` Skill。

## 受控策略进化

```text
真实运行 → 独立评价 → 指标观察 → 固定基准
         → 基线/候选同 case 对比 → 机械重算 → 拒绝/待审/晋级
                                                ↓
                                          归档与回滚
```

一次可信实验必须包含：

- 不可变 benchmark manifest 与 SHA-256；
- 基线和候选完全相同的 case IDs；
- 每个 case 的分数、verdict、artifact 和 SHA-256；
- 独立策略 evaluator 的命令证据；
- 最小样本数与最小提升阈值；
- 中高风险循环的 digest-bound 人工批准。

```bash
loopctl evolve <loop-dir> --experiment experiment.json

# 输出 pending-review 后，由人类生成绑定当前实验摘要的批准文件
loopctl approval create <loop-dir> \
  --experiment experiment.json \
  --approver "name" \
  --reason "matched evidence passed review" \
  --out approval.json

loopctl evolve <loop-dir> \
  --experiment experiment.json \
  --approval approval.json

# 后续证据回归时，恢复 v1 行为并生成一个新的版本
loopctl strategy rollback <loop-dir> \
  --to 1 \
  --actor "name" \
  --reason "post-promotion regression"
```

候选只能修改 `strategy.json.instructions`。`loop.yaml`、权限、发现边界、预算、验证命令、证据要求和人工门槛不可由候选修改。

## 核心命令

```bash
loopctl skill validate [dir]
loopctl skill install <codex|claude-code|both> --scope <project|user>
loopctl validate <loop.yaml...>
loopctl init <name> --from <loop.yaml> --out <directory>
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl evolve <loop-dir> --experiment <experiment.json> [--approval <approval.json>]
loopctl approval create <loop-dir> --experiment <file> --approver <name> --reason <text> --out <file>
loopctl strategy rollback <loop-dir> --to <version> --actor <name> --reason <text>
loopctl status --root .loop-engineering/loops
loopctl runs <loop-dir>
loopctl pause <loop-dir> --reason <text>
loopctl resume <loop-dir>
loopctl check <schema> <file...>
loopctl schema <schema>
loopctl doctor
```

支持的实例渲染器：

- `codex`
- `claude-code`
- `chatgpt`
- `openclaw`
- `generic-harness`
- `github-actions-scaffold`

## 证据与安全模型

生成器产生候选结果，独立 evaluator 决定结果是否通过，人类决定高风险外部动作是否发生。

运行日志会验证 evaluator artifact 的 Schema、loop/item/verdict/context 绑定和 SHA-256。通过结果还必须覆盖 `loop.yaml` 中配置的证据类型与成功命令。`passed + []`、状态与 verdict 不一致、重复 item、未知 item、预算超限或未来时间戳都会被拒绝。

必须明确：当前 Runner 不是操作系统沙箱。命令执行器使用当前用户权限，并且只有显式传入 `--allow-command` 才会启动；这个标志不等于允许合并、部署、删除、花费、外部发送或修改权限。不要把高权限生产凭据交给无人值守循环，也不要在不可信仓库中启用命令执行器。

## 仓库结构

```text
skills/loop-engineering/   canonical Agent Skill、references、assets、scripts、evals
.codex-plugin/             Codex 插件清单
.claude-plugin/            Claude Code 插件与 marketplace 清单
.agents/plugins/           Codex marketplace 清单
protocol/                  协议 Schema
src/                       loopctl、Runner、进化与安装实现
templates/                 Skill assets 的兼容镜像
adapters/                  非 canonical 平台适配说明
examples/                  通过校验的循环示例
test/                      运行时、证据、安全、安装与渲染测试
docs/                      架构、协议、定位与发布说明
```

## 当前边界

- `loopd` 提供本地 reference runtime，但尚未内置 Codex、Claude 或 OpenClaw SDK；真实 Agent 通过 command executor 或平台调度接入。
- GitHub Actions 输出是手动、只读的 preflight scaffold；加入真实 executor、持久状态通道、最小权限和密钥策略后才能调度。
- 文件级原子写入、租约 token 和超时已经实现，但它不是分布式数据库或容器沙箱。
- 策略进化提供可验证的外部策略优化，不承诺每次候选都更好，也不宣称模型自主训练。

## 开发与发布验证

```bash
npm ci
npm run build
npm run smoke
npm pack --dry-run
npm publish --dry-run
gh skill publish --dry-run
```

`npm run build` 从唯一来源生成静态适配器，并将 Skill 内的 canonical assets 同步到 `templates/`；`loopctl doctor` 会阻止漂移。

更多文档：

- [产品定位](docs/positioning.md)
- [架构](docs/architecture.md)
- [协议](docs/protocol.md)
- [Runner](docs/runner-design.md)
- [适配器](docs/adapters.md)
- [发布检查清单](docs/publish-checklist.md)
- [路线图](docs/roadmap.md)

## License

MIT
