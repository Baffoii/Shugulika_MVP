# D-2 — Messaging: Meta WhatsApp Cloud API (replaces Twilio-first plan)

> **Status:** Proposed replacement decision  
> **Supersedes:** PR #37 / `docs/whatsapp-email-notifications-plan` (Twilio-first)  
> **Date:** 2026-08-04  
> **Scope:** Architecture decision only; no live provider activation in this document.

## Decision

Use the **official Meta WhatsApp Cloud API** for approved outbound notifications first.

Required companion pieces:

- common notification outbox (Boundary 2)
- consent / preference records in Shugulika
- approved message templates with English and Swahili versions
- delivery webhooks with signature verification and dedupe (Boundary 4)
- email and in-app fallback when WhatsApp is unavailable or opted out
- secure portal links instead of sensitive result/CV content in messages
- two-way WhatsApp messaging as a **later add-on** only after outbound delivery, consent, and ops are stable

## Why replace the Twilio-first plan

The earlier plan optimized for Twilio as the first WhatsApp path. The product direction is direct Meta Cloud API ownership for templates, webhooks, and compliance clarity, with Shugulika remaining the consent and outbox system of record.

## Non-negotiables

- Credentials server-only.
- Fail closed when WhatsApp is disabled or secrets missing.
- Provider delivery failure never rolls back the underlying employer/candidate business event.
- No automatic two-way conversational agent in v1.

## Rollout

1. Shared notification outbox + disabled Meta adapter.
2. Template registration (EN/SW) and sandbox send.
3. Webhook verify + dedupe + preference/opt-out.
4. Production flag enablement after ops runbook.
5. Two-way messaging policy/ops phase separately.
