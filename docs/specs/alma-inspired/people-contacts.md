<!--
Input: Alma People settings evidence and Cradle identity audit.
Output: Spec for people/contact profiles.
Position: docs/specs/alma-inspired/people-contacts.md
-->

# People And Contacts

## Goal

Cradle should provide a human contact projection for external channels, mentions, and collaboration metadata without confusing people with agent identities.

## Alma Evidence

Alma settings include People management with Telegram ID, Discord ID, Discord username, Feishu ID, username, profile, and avatar upload/remove.

## Cradle Current State

Cradle has agent identity, issue actor context, and profiles, but no cross-channel human contact model.

## Target Ownership

A future `people` module owns Cradle contact records and cross-channel identity links. Channel connectors can read and propose mappings but do not own people lifecycle.

## Target Behavior

- Users can create, edit, merge, archive, and search people.
- A person can link multiple external identities.
- Channel messages can resolve sender display metadata to a person record.
- Agent identities remain separate from people.

## API Sketch

- `GET /people`
- `POST /people`
- `PUT /people/:id`
- `POST /people/:id/links`
- `DELETE /people/:id/links/:linkId`

## Data Model

Tables should include `people`, `person_identity_links`, and optional avatar asset references.

## Acceptance

- The same person can be linked to Discord and Feishu identities.
- Removing a channel connector does not delete people records.
- Agent identity APIs never return people records as agents.
