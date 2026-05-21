<!--
Input: Alma network settings evidence and Cradle provider/network gap.
Output: Spec for network proxy and request policy.
Position: docs/specs/alma-inspired/network-proxy.md
-->

# Network Proxy 与 Request Policy

## 目标

Cradle 需要一个 centralized network policy，供 providers、connectors、web fetch、plugin downloads、desktop update checks 和 diagnostics 读取。各模块可以声明 bypass，但不能各自保存互相冲突的 proxy 语义。

## Alma 证据

Alma settings 包含 HTTP/HTTPS/SOCKS5 proxy、authentication、proxy test、prefer IPv4、timeout、retry 和 custom user agent。这是明确的桌面产品级网络策略面。

## Cradle 当前状态

Cradle provider profiles 可以配置 provider-specific base URLs 和 credentials。当前没有发现 global proxy、retry、timeout、prefer IPv4 或 user-agent settings surface。

## Owner / Namespace

未来 `network` preference owner 保存全局 request policy。`secrets` 保存 proxy credentials。Providers、connectors、web fetch、plugin marketplace 和 desktop updater 只读取 policy，不写入 policy namespace。

## 目标行为

- 用户可以配置 proxy URL、auth、timeout、retry、IPv4 preference 和 user agent。
- 每个 module 默认读取 global policy；需要 bypass 时必须记录原因。
- Test action 验证在当前 policy 下的 connectivity。
- Proxy credentials 在 UI、logs 和 export 中必须被 masked。

## API 草案

- `GET /network/policy`
- `PUT /network/policy`
- `POST /network/policy/test`

## 数据模型

Preferences 保存非 secret policy，例如 proxy kind、host、port、timeout、retry、prefer IPv4、user agent 和 bypass list。Proxy username/password 或 token 放入 `secrets`，policy 只保存 secret id reference。

## 验收

- Provider health check 默认使用 network policy，除非该 provider 明确声明 bypass。
- Proxy test 能区分 DNS、connect、TLS、auth 和 HTTP status failures。
- 清空 proxy settings 会移除未被其他 policy 使用的 secret reference。
- Export preferences 不包含明文 proxy credentials。
