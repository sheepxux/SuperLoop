<p align="center">
  <img src="docs/assets/cover.png" alt="SuperLoop" width="720">
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

# SuperLoop

一个可安装的高级 Agent Skill，以及支撑它运行的本地参考运行时。

SuperLoop 先把模糊想法编译成可审阅的目标，再用明确、可审计的工程契约管理周期性或有限长时程 Agent 工作：

```text
模糊想法 → Goal Contract + LoopProposal（不可执行）
                         → 人类确认精确摘要 → loop.yaml → 持续发现，或固定 Work Plan
                                                      → Part Gate → 持久化 → 下一 Part
                                                      → 最终 Goal Gate → 完成
                                                                      ↓
                                                        匹配基准 → 策略晋级或回滚
```

它的第一身份是 `skills/superloop` 下的完整 Skill；`loopctl`、`loopd`、协议 Schema 和平台插件是 Skill 的确定性执行底座。

## 当前版本：v2.0.0

> **v2 破坏性变更：** 正式标识现已统一为 `@sheepxux/superloop`、`$superloop`、`superloop/v2`、`.superloop/loops` 和 `github.com/sheepxux/SuperLoop`。已有 v1 Loop 的协议与持久路径属于获批契约，必须创建父摘要相连的提案 revision、重新获得人类批准并初始化新的 v2 Loop；不得原地改写旧契约，也不得自动继承旧 Part/Goal 的通过状态。

`v2.0.0` 新增 Idea-to-Loop 设计层：Skill 会把模糊想法转成带证据的 Goal Contract 和不可执行的 `LoopProposal`，最多询问 3 个真正改变设计的问题；人类确认绑定提案的精确 SHA-256，运行时随后确定性编译 `loop.yaml`。提案被改动、仍有阻塞项或确认摘要不匹配时都会失败关闭。摘要使用固定的 [Canonical JSON 规则](docs/canonical-json.md)，可由外部审批系统复现。

编译产物会把完整 Goal Contract 保存在 `loop.yaml.goalContract` 中。`metadata.provenance` 同时绑定原提案、获批候选 Loop 正文和 Goal Contract 的摘要，并保留可重建人类批准文件的字段与摘要；`loopctl validate` 会重新计算这些绑定。配合保留的原始 proposal/decision 或可信摘要，编译后的契约可检出篡改；本地摘要提供完整性证据，但不是签名或身份认证。

有限的复杂任务使用同一个 Loop 和同一个 Goal Contract：固定 Work Plan 把完整结果分成带依赖、预期产物和精确验收条件的 Parts；每次 Iteration 只尝试一个已解锁 Part，独立 Part Gate 通过后才推进。不同 Parts 可以声明各自的证据类型和验证命令，未声明时才继承 Loop 级默认验证。所有 Parts 通过后，另一个独立 Goal Gate 会对完整结果逐条检查全局验收条件，只有它通过才进入 `completed`。Parts 从获批 Goal 推导，不来自写作、软件、研究或迁移等领域模板。

`v1.0.2` 已有的本地 Runner、独立验证、持久状态、事务恢复、预算、人工门槛和受控策略进化全部保留。Schema 通过只证明结构与跨字段不变量成立；目标是否符合真实意图，仍由人类审阅和独立 Skill 评测共同判断。

这里的“进化”是**基准驱动的任务策略优化**，不是修改模型权重，也不是让 Agent 自主削弱安全约束。

## 它会做什么

当输入还是一个想法时，Skill 默认进入 `Propose`：保存原始意图、显式记录假设、产出可验证目标和建议 Loop 结构，但不创建运行状态，也不执行外部动作。它同时把请求分成四类：

- `one-shot`：能在一次有界执行和验收上下文中完成，直接处理，不创建循环。
- `deterministic`：优先使用脚本、CI 或 cron。
- `agentic-loop`：为需要周期性判断，或需要多个可验证 Parts 才能完成的有限长时程任务设计循环。
- `unsafe-loop`：加入人工门槛，或拒绝无人值守执行。

对于适合循环化的任务，它支持八种工作模式：提案、评估、设计、脚手架、运行、审查、恢复和策略进化。`Propose` 与 `Design` 不会静默升级到 `Scaffold` 或 `Run`。

## 完整能力

- 标准 Agent Skills 目录：`SKILL.md`、`agents/openai.yaml`、`references/`、`scripts/`、`assets/` 和 `evals/`。
- 一份 canonical Skill 同时服务 Codex 与 Claude Code，避免多份正文漂移。
- Codex 和 Claude Code 插件/marketplace 清单，以及 source/npm 安装回退。
- 可移植的 `loop.yaml` 协议和 JSON Schema 安全校验。
- 不可执行的 `LoopProposal`、证据化 Goal Contract、最多 3 个关键问题、显式假设与 prerequisite/readiness 质量门槛。
- 独立的 `LoopProposalDecision`；批准、拒绝和要求修改都绑定提案 ID、revision 与规范化 SHA-256，批准后才能确定性编译带 provenance 的 `loop.yaml`。
- 可选的通用有限 Work Plan：稳定 Part IDs、无环依赖、精确 Goal 追踪、可扩展证据类型、异构 Part 验证命令、产物摘要绑定、一次只推进已解锁 Parts，以及独立最终 Goal Gate。
- `loopctl next` 显式返回 `work`、`goal-evaluation` 或 `completed` 阶段；失败 Part 保持重试边界，锁定 Part 不能越级，最终验收失败只重开有证据关联的 Parts 及其后继。
- 持久状态、运行计划、暂停/恢复、重试队列、人工收件箱和审计日志；持续流保留最近 1000 次运行摘要，有限 Work Plan 保留完成因果回放所需的完整运行账本。
- 状态与 lease 绑定 loop generation 和精确契约摘要；进化运行、当前策略与归档策略绑定版本和 SHA-256，过期工作不能跨代提交。
- 每个任务结果必须绑定独立 evaluator artifact、context ID 和 SHA-256；空结果不能伪装成功。
- 条目、发现数、单次时长、每日运行次数和单次成本预算会机械拒绝超限记录；并发记录也不能丢失或绕过预算。
- 命令已经产生的超限消耗会以仅记账的 `budget-exceeded` 记录持久化并计入每日运行、时长和成本预算，不会写入任务结果或进化指标，也不会因 draft 被拒而归零。
- 只有受信任的 dry-run Runner 可以写入观测记录；真实 command executor 不能把执行伪装成不计费的 `dry-run`。
- 本地 `loopd` Runner、串行状态锁、失败关闭的原子文件租约、受信任的运行时间边界、超时、事件流和独立运行目录。
- 固定 benchmark manifest、匹配 case IDs、baseline/candidate 策略摘要，以及逐例 arm/策略摘要/评估者身份/context/命令证据绑定的策略实验。
- 新实验必须先满足配置的运行次数或连续失败触发门槛，并且同一循环最多保留一个 pending experiment。
- 聚合分数由逐例结果机械重算，不能只提交自报分数。
- 人工批准和拒绝都绑定已暂存实验的 SHA-256；拒绝会写入不可变 decision，并要求新的真实运行证据才能再次实验。
- 所有策略版本按连续父链归档；回滚会恢复旧行为并生成新的单调版本，不改写历史，存在 pending experiment 时不能回滚。
- Codex/Claude 的每循环实例 Skill、ChatGPT 顾问说明、OpenClaw 与通用 harness 适配器。
- GitHub Actions 只生成明确标注的只读 preflight scaffold，不冒充完整执行器。

可直接查看并校验[通用有限 Work Plan 示例](examples/finite-project/loop.yaml)及其[非执行 Proposal 示例](examples/idea-to-loop/finite-project.proposal.yaml)；它们只使用 Goal、Parts、依赖、Part Gates 与最终 Goal Gate，不包含任何写作或其他领域特例。

## 安装 Skill

### 使用 GitHub Skill（推荐，当前为 GitHub CLI 预览能力）

```bash
gh skill install sheepxux/SuperLoop superloop@v2.0.0 --agent codex
gh skill install sheepxux/SuperLoop superloop@v2.0.0 --agent claude-code
```

### Codex 插件

```text
codex plugin marketplace add sheepxux/SuperLoop --ref v2.0.0
codex plugin add superloop@superloop
```

### Claude Code 插件

```text
claude plugin marketplace add sheepxux/SuperLoop@v2.0.0
claude plugin install superloop@superloop
```

### 从源码安装并验证

```bash
git clone --branch v2.0.0 https://github.com/sheepxux/SuperLoop.git
cd SuperLoop
npm ci
node ./bin/loopctl.js skill validate

# 项目级安装；使用 --scope user 可安装到用户目录
node ./bin/loopctl.js skill install both --scope project
```

发布者完成可选的 npm registry 发布后，也可以使用：

```bash
npm install --global @sheepxux/superloop@2.0.0
loopctl skill install both --scope user
```

## 快速开始

以下命令直接使用固定的 GitHub `v2.0.0` 运行时，不要求插件把 `loopctl` 写入 `PATH`。在源码仓库内也可以把此前缀替换为 `node ./bin/loopctl.js`（`loopd` 使用 `node ./bin/loopd.js`）。

```bash
RUNTIME="github:sheepxux/SuperLoop#v2.0.0"

# 检查 Skill、Schema、插件元数据和生成文件是否一致
npm exec --yes --package="$RUNTIME" -- loopctl doctor
npm exec --yes --package="$RUNTIME" -- loopctl skill validate

# 先让 $superloop Skill 把想法写成 proposal.yaml；提案不会执行
npm exec --yes --package="$RUNTIME" -- loopctl proposal validate proposal.yaml

# 先解决 blockers；由人类确认假设和 prerequisites，并确保 readiness 为 ready-for-review
# 只有人类完整审阅后才创建摘要绑定的批准文件
npm exec --yes --package="$RUNTIME" -- loopctl proposal decide proposal.yaml \
  --approve --actor "your-name" --reason "goal and boundaries reviewed" \
  --out proposal-decision.json

# 编译会验证批准摘要并写入 provenance；任何篡改都会被拒绝
npm exec --yes --package="$RUNTIME" -- loopctl proposal compile proposal.yaml \
  --decision proposal-decision.json --out loop.yaml

# 从已批准的契约初始化循环；名称必须与 loop.yaml 的 metadata.name 完全相同
LOOP_NAME="<loop.yaml metadata.name>"
npm exec --yes --package="$RUNTIME" -- loopctl init "$LOOP_NAME" \
  --from loop.yaml --out .superloop/loops

# 运行前机械检查预算、重试和人工门槛
npm exec --yes --package="$RUNTIME" -- loopctl next ".superloop/loops/$LOOP_NAME"

# 为具体循环生成平台实例 Skill
npm exec --yes --package="$RUNTIME" -- loopctl render codex ".superloop/loops/$LOOP_NAME/loop.yaml" --out .
npm exec --yes --package="$RUNTIME" -- loopctl render claude-code ".superloop/loops/$LOOP_NAME/loop.yaml" --out .

# 安全测试 Runner；不会计入任务成功或进化指标
npm exec --yes --package="$RUNTIME" -- loopd start --once --loop "$LOOP_NAME"
```

Codex 实例写入 `.agents/skills/<loop-name>/`；Claude Code 实例写入 `.claude/skills/<loop-name>/`。它们是具体循环的执行入口，不会覆盖 canonical `superloop` Skill。

仓库内置的 `skills/superloop/assets/proposal.yaml` **有意保持为 `needs-input`**：其中的假设尚未确认、仓库访问 prerequisite 尚未满足，不能直接批准。人类必须审阅并确认或否决每个假设，核实 prerequisite 的真实状态，再让 readiness 与 blockers 反映事实；只有无阻塞项的 `ready-for-review` 提案才能批准。

如果人类要求修改，创建摘要相连的新 revision，不要覆盖旧提案。第二版及以后在验证、决定和编译时都必须提供精确父提案：

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
# 编辑 proposal-v2.yaml，解决修改意见，并由人类确认假设与 prerequisites
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml \
  --approve --actor "your-name" --reason "revision and prerequisites reviewed" \
  --out proposal-v2-decision.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml \
  --decision proposal-v2-decision.json --out loop.yaml
```

对提案编译出的契约，`init` 不会改名或搬迁已审阅的持久化路径：`<name>` 必须精确等于 `loop.yaml.metadata.name`，`--out` 必须是 `.superloop/loops`，并生成 `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`。需要改变名称或路径时，必须修订提案并重新批准。

直接编写 `loop.yaml` 只用于用户提供的现有契约，或用户明确要求的专家直写路径；Agent 不得自行把模糊或全新的想法切到这条路径来绕过 Proposal 审阅。

## 从 Loop-Engineering v1.1.0 迁移到 SuperLoop v2

先停止旧 Runner 并完整备份 `.loop-engineering/loops/<name>`。如果旧契约包含 `metadata.provenance`，必须从原始 proposal 创建父摘要相连的新 revision，把候选契约的 `apiVersion` 更新为 `superloop/v2`，把 persistence 路径更新到 `.superloop/loops/<name>/...`，然后重新验证、重新由人类批准并编译：

```bash
# 使用 SuperLoop v2 处理修订后的 proposal-v2.yaml
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml \
  --approve --actor "your-name" --reason "SuperLoop v2 identity and persistence migration reviewed" \
  --out proposal-v2-decision.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml \
  --decision proposal-v2-decision.json --out loop-v2.yaml
loopctl init "<exact metadata.name>" --from loop-v2.yaml --out .superloop/loops
```

旧运行记录继续保留在 `.loop-engineering` 目录作为不可变审计证据。v2 会创建新的 generation、契约摘要、状态和运行账本；旧 Part/Goal 通过、pending experiment 和审批不会自动转换成 v2 成功证据。没有原始 proposal/decision 的专家直写 v1 契约，必须由人审阅后显式重写为 v2 契约，不能让运行时猜测授权边界。

## 从 v1.0.1 升级到 v1.0.2（历史）

先停止 `loopd`，确认循环没有正在执行的任务，并备份循环目录。然后使用 `v1.0.2` 运行时逐个迁移已有循环：

```bash
RUNTIME="github:sheepxux/SuperLoop#v1.0.2"
LOOP_DIR=".loop-engineering/loops/<name>"

npm exec --yes --package="$RUNTIME" -- loopctl migrate "$LOOP_DIR"
npm exec --yes --package="$RUNTIME" -- loopctl validate "$LOOP_DIR/loop.yaml"
npm exec --yes --package="$RUNTIME" -- loopctl next "$LOOP_DIR"
```

`migrate` 会为持久状态加入 loop generation 标识和精确的 `loop.yaml` SHA-256 绑定，并锚定从 `v1` 到当前版本的完整、连续策略父链。对已经迁移且一致的循环，重复运行是经过校验的幂等 no-op。契约不一致、策略版本不一致、缺失/多余/断链归档或不可验证的状态都会让迁移失败关闭；不要通过手改 `state.json` 绕过检查。

如果存在已过期 lease：同机且 PID 已确认退出时，迁移可以将 lease 保留为带摘要的 retired 审计文件；远程主机或无法证明进程已死亡时，必须由操作者先核验，再显式加入 `--retire-expired-lease`。该标志不会绕过未过期 lease、同机仍存活 PID 或损坏 lease 的拒绝。

迁移不会把旧实验或审批转换为新证据。旧 pending experiment 会在历史中标记为 `invalidated` 并解除 pending；必须使用**新的 experiment ID**，按照 `v1.0.2` 的逐案例 evaluator/attestation 格式重建并重新暂存，旧审批不得复用。迁移会为这一次重建保留到期触发；之后的新实验仍只有在 `evolution.trigger.afterRuns` 或 `evolution.trigger.consecutiveFailures` 达到门槛时才能暂存，并且同一循环同时只能存在一个待审实验。

## 受控策略进化

```text
真实运行 → 独立评价 → 指标观察 → 固定基准
         → 基线/候选同 case 对比 → 机械重算 → 拒绝/待审/晋级
                                                ↓
                                          归档与回滚
```

一次可信实验必须包含：

- 不可变 benchmark manifest 与 SHA-256；
- 基线和候选完全相同的 case IDs，并分别绑定 baseline/candidate 的策略 SHA-256；
- 每个 case 的分数、verdict、artifact、SHA-256、评估者身份、独立 context、arm 和对应策略 SHA-256；
- 逐案例命令证据，以及绑定完整 benchmark/evidence 的策略 evaluator 摘要；
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

# 或由独立人类拒绝精确的 pending 实验；decision 会不可变持久化
loopctl experiment reject <loop-dir> \
  --experiment experiment.json \
  --actor "name" \
  --reason "evidence is insufficient"

# 只有不存在 pending experiment 时，才可恢复 v1 行为并生成新版本
loopctl strategy rollback <loop-dir> \
  --to 1 \
  --actor "name" \
  --reason "post-promotion regression"
```

候选只能修改 `strategy.json.instructions`。`loop.yaml`、权限、发现边界、预算、验证命令、证据要求和人工门槛不可由候选修改。

拒绝 pending experiment 会把精确实验摘要、独立 actor、时间和理由写入不可变 decision artifact，并把该历史结果标为 `abandoned`。这会消费当前实验触发窗口；只有新的、可归因且带任务结果的运行证据重新达到配置门槛后，才能使用新的 experiment ID 发起下一次实验。`dry-run`、`no-work` 和 `budget-exceeded` 不增加实验触发计数。

## 核心命令

```bash
loopctl skill validate [dir]
loopctl skill install <codex|claude-code|both> --scope <project|user>
loopctl proposal validate <proposal.yaml...> [--parent <parent-proposal.yaml>]
loopctl proposal revise <parent-proposal.yaml> --out <proposal.yaml>
loopctl proposal decide <proposal.yaml> [--parent <parent-proposal.yaml>] --approve|--reject|--request-changes [--change <text>] --actor <human> --reason <text> --out <decision.json>
loopctl proposal compile <proposal.yaml> [--parent <parent-proposal.yaml>] --decision <decision.json> --out <loop.yaml>
loopctl validate <loop.yaml...>
loopctl init <name> --from <loop.yaml> --out <directory>
loopctl migrate <loop-dir|loop.yaml> [--retire-expired-lease]
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl evolve <loop-dir> --experiment <experiment.json> [--approval <approval.json>]
loopctl approval create <loop-dir> --experiment <file> --approver <name> --reason <text> --out <file>
loopctl experiment reject <loop-dir> --experiment <file> --actor <human> --reason <text>
loopctl strategy rollback <loop-dir> --to <version> --actor <name> --reason <text>
loopctl status --root .superloop/loops
loopctl runs <loop-dir>
loopctl pause <loop-dir> --reason <text>
loopctl resume <loop-dir>
loopctl part reopen <loop-dir> --id <part-id> --actor <human> --reason <text>
loopctl goal resolve <loop-dir> --actor <human> --reason <text>
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

生成器产生候选结果，独立 evaluator 决定结果是否通过，人类决定高风险外部动作是否发生。有限 Work Plan 中，中间 evaluator 只检查当前 Part 的精确条件和声明产物；完整 Goal 条件只由最后的独立 Goal Gate 检查，避免要求中间 Part 假装完成全部目标。

运行日志会验证 evaluator artifact 的 Schema、配置身份、loop/item/verdict/context 绑定、真实目录边界和 SHA-256。有限 Work Plan 的通过结果还必须让每个声明产物指向 Loop 目录内不同的、按运行版本化的真实快照，并由运行时重算内容 SHA-256；已接受快照不可覆盖，修正应从独立工作文件生成新快照，外部交付物则保留本地导出或回执。通过结果还必须覆盖当前 Part 的有效证据/命令（Part 自己声明的 envelope，或未声明时的 Loop 级默认），最终 Goal Gate 则覆盖完整全局 envelope。`passed + []`、状态与 verdict 不一致、重复或未知 item、终态覆盖、发现/预算超限、状态缺失、历史倒退或未来时间戳都会被拒绝。Runner 会覆盖 command draft 的 `startedAt`/`finishedAt`，用自己的真实时间界定执行和 UTC 记账日；记账日不可倒退。状态中的运行 ledger 时间必须单调，`lastRunAt` 必须对应最新非 dry-run 记录。事务恢复会从 journal 前态和不可变 artifact 机械重算目标状态与记账日，而不是信任部分写入。运行记录不可变；相同重放幂等，但仍会重新核验 evaluator 与 Part 产物证据，不会重复扣减预算。

必须明确：当前 Runner 不是操作系统沙箱。命令执行器使用当前用户权限，并且只有显式传入 `--allow-command` 才会启动；这个标志不等于允许合并、部署、删除、花费、外部发送或修改权限。不要把高权限生产凭据交给无人值守循环，也不要在不可信仓库中启用命令执行器。

## 仓库结构

```text
skills/superloop/   canonical Agent Skill、references、assets、scripts、evals
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

- “通用”指控制协议与 Part 模型不绑定领域，不代表字面上的任意任务都能自动完成；任务仍需可有界分解、可留下持久证据、可独立评估，并已接入真实 worker、evaluator、工具和凭据。
- `loopd` 提供本地 reference runtime，但尚未内置 Codex、Claude 或 OpenClaw SDK；真实 Agent 通过 command executor 或平台调度接入。
- GitHub Actions 输出是手动、只读的 preflight scaffold；加入真实 executor、持久状态通道、最小权限和密钥策略后才能调度。
- 文件级原子写入、串行状态锁、lease 操作锁、owner token 和超时已经实现；状态锁的 acquire/reclaim 共用原子门闩以避免 ABA 竞态，若进程恰好在门闩内崩溃则会安全阻塞并要求确认无存活进程后人工清理。它不是分布式数据库或容器沙箱。
- 运行、状态、实验、审批、拒绝 decision、策略晋级与回滚使用可恢复事务 journal；这是本地文件系统完整性机制，不是跨主机共识协议。
- 命令执行器必须前台运行且不能遗留后台子进程；当前同步 reference Runner 没有执行中的异步 heartbeat 或进程组级沙箱。
- `approval.approver` 和 `decision.actor` 是本地审计声明，不是经过身份提供方认证的签名；运行时会拒绝已配置 worker/evaluator 自批或自拒，但高风险治理仍依赖真实的人类流程。
- evaluator 的 identity/contextId 是可审计协议绑定，不是密码学身份或进程隔离证明；真实的独立上下文必须由接入平台或执行器创建。
- 有限 Work Plan 在执行中保持固定；如果 Part 范围、顺序、依赖、产物、验收或最终 Goal Gate 发生变化，必须停止并创建带父摘要的新 proposal revision，不能静默扩充计划。
- `blocked` / `needs-human` 不会被普通 `resume` 偷偷改成可执行：Part 与最终 Goal 分别需要 `part reopen` / `goal resolve`，并持久化独立 actor、理由与原始失败运行绑定。
- 策略进化提供可验证的外部策略优化，不承诺每次候选都更好，也不宣称模型自主训练。

## 开发与发布验证

```bash
npm ci
npm run build
npm run smoke
npm run package:smoke
npm pack --dry-run
npm publish --dry-run
gh skill publish --dry-run
```

`npm run build` 从唯一来源生成静态适配器，并将 Skill 内的 canonical assets 同步到 `templates/`；`loopctl doctor` 会阻止漂移。`package:smoke` 会真实打包，在空项目安装 tarball 与双平台 Skill，并验证旧 runtime 不会绕过无依赖 Codex helper 的精确版本回退。新会话结果汇总与 digest-bound 逐 expectation 人工审阅记录保存在 `skills/superloop/evals/`；原始模型 transcript、模型标识和 provider attestation 未保留，因此不能把它描述为可复现的供应商评测。

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
