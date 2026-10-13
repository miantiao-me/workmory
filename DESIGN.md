# Workmory Web 视觉合同

## Coss 原版优先

Workmory Web 以固定版本的 Coss Cal.com 示例和 Coss particles 为视觉权威来源：

1. 优先直接采用官方 primitive。
2. 优先复制官方 particle、共享组件和页面的默认 composition 与类名。
3. 仅替换 Workmory 的路由、文案、数据和业务行为，不重新设计官方结构。
4. 官方源码与本地实现不一致时，在不改变业务、安全和可访问性语义的前提下，以官方布局、间距、密度、状态和响应式类为准。

权威目录：

- `web/coss-globals.css`（固定于 Coss commit `19620ae8cae81e30775f2cde03829326cb4916b2` 的 `packages/ui/src/styles/globals.css`）
- `.slim/clonedeps/repos/cosscom__coss/apps/examples/calcom/`
- `.slim/clonedeps/repos/cosscom__coss/apps/ui/registry/default/particles/`
- `web/components/ui/`

## 实现约束

- 使用 `background`、`card`、`popover`、`sidebar` 等 Coss 语义 token；禁止新增本地 surface token。
- 标准 token、base rule、radius 和 animation 来自 vendored 官方 globals；`web/styles.css` 仅可包含 standalone shell、系统字体和移动端适配。
- 禁止用 arbitrary color、border、radius 或 shadow 重建 primitive 已提供的表面。
- 禁止用通用 `rounded border bg-* shadow-*` 容器替代现有 Card、CardFrame、Alert、Empty、ListItem 等 primitive 或 particle。
- 导航使用官方 active fill 和文字状态，但不使用左侧 border、inset line 或其他激活指示线。
- 保留官方断点、组件 slot、键盘语义和移动端 overflow 行为。
- 视觉恢复不得修改 API、认证、owner 隔离、CAS、幂等、筛选、分页或其他业务逻辑。

## 最小产品适配

以下适配可以保留，但应尽量使用官方 primitive 和语义类：

- 移动端安全区内边距。
- 数据表和受限代码区域的横向滚动，且不得撑宽页面。
- 默认 project/namespace 上下文展示。
- 具备必要层级、可读性和交互语义的通知。
- 保持可读、可滚动且不破坏文档布局的 JSON 展示。
