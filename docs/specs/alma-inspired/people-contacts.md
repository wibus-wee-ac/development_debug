# People 与 Contacts

## 目标

Cradle 需要提供 human contact projection，用于外部 channels、mentions 和协作 metadata，同时不能把人类联系人和 agent identities 混在一起。

## Alma 证据

Alma settings 包含 People 管理，字段包括 Telegram ID、Discord ID、Discord username、Feishu ID、username、profile、avatar upload/remove。

## Cradle 当前状态

Cradle 有 agent identity、issue actor context 和 profiles，但没有跨 channel 的 human contact model。

## Owner / Namespace

未来 `people` module 拥有 Cradle contact records 和 cross-channel identity links。Channel connectors 可以读取并提出 mapping，但不拥有 people lifecycle。

## 目标行为

- 用户可以创建、编辑、合并、归档、搜索 people。
- 一个 person 可以链接多个 external identities。
- Channel messages 可以把 sender display metadata 解析到 person record。
- Agent identities 与 people records 完全分离。

## API 草案

- `GET /people`
- `POST /people`
- `PUT /people/:id`
- `POST /people/:id/links`
- `DELETE /people/:id/links/:linkId`

## 数据模型

表应包含 `people`、`person_identity_links`，头像可引用 asset records。

## 验收

- 同一个 person 可以同时链接 Discord 与 Feishu identity。
- 移除 channel connector 不删除 people records。
- Agent identity APIs 不返回 people records 作为 agents。
