# Navalia — WhatsApp Workflow

## Overview

WhatsApp is a **first-class booking channel** in Navalia, not a simulation. Each barbershop connects its **own WhatsApp number**; an AI chatbot answers customers and books real appointments using the same booking engine as every other channel.

Integration is via [Evolution API v2](https://doc.evolution-api.com/) (self-hosted, Baileys-based). Trade-off: it is **not** the official Meta API — Meta can ban numbers flagged for spam. This risk is documented to shop owners, and the adapter design keeps a future migration to the WhatsApp Cloud API cheap (see [Roadmap](#roadmap)).

## Per-tenant connection flow

1. Owner opens **Dashboard → WhatsApp**.
2. App calls Evolution `POST /instance/create` with instance name `navalia_{barbershopId}` and webhook pre-configured to `/api/webhooks/evolution`.
3. Dashboard renders the QR code returned by Evolution; owner scans it with the shop's phone (WhatsApp → Linked Devices).
4. Evolution fires connection status events → app updates `Barbershop.whatsappStatus` (`DISCONNECTED | CONNECTING | CONNECTED`).
5. Dashboard offers disconnect/reconnect (logout + new QR).

`Barbershop.evolutionInstanceId` stores the instance name; the webhook resolves the tenant from it.

## Inbound message pipeline

```
Customer msg → Evolution webhook → /api/webhooks/evolution
  → verify apikey header
  → resolve tenant by instance name
  → persist WhatsappMessage (INBOUND)
  → Redis debounce 4s per (tenant, phone)   ← merges fragmented messages
  → build context: conversation history + barbershop info
  → runAssistant('WHATSAPP', tenantId, messages, ctx)
       tools: getServices | getSlots | createAppointment
              | cancelAppointment | getBusinessInfo
  → persist WhatsappMessage (OUTBOUND)
  → Evolution POST /message/sendText
```

### Debounce
People type in bursts ("quero cortar" / "amanhã" / "de tarde"). Each inbound message resets a 4-second Redis key; processing runs only when the timer fires, concatenating buffered messages into one turn.

### Conversation state
`WhatsappConversation` keyed by `(barbershopId, customerPhone)` with `state: OPEN | WAITING_CONFIRMATION | APPOINTMENT_CREATED | TRANSFERRED_TO_HUMAN | CLOSED`. History feeds the model (windowed). `TRANSFERRED_TO_HUMAN` silences the bot for that conversation until reopened.

## Chatbot rules

- Short, natural, pt-BR replies — WhatsApp register, not essay register.
- Domain-only: services, prices, hours, availability, appointments. Off-topic → polite redirect.
- Always check **real** availability via tools; never invent slots.
- Ask for the customer's **name** before booking (phone comes from the conversation).
- **Never** call `createAppointment` without an explicit "yes" to a recap ("Confirma corte + barba amanhã às 18:30 com João?").
- Customer is created/reused by phone; appointment `source = WHATSAPP`.
- On error or on request ("quero falar com atendente") → fallback message + `TRANSFERRED_TO_HUMAN`.
- Every tool call logged in `AiActionLog`.

### Example conversation

```
Customer: Tem horário amanhã depois das 18h pra corte e barba?
Bot:      Tenho sim! Amanhã tenho 18:30 e 19:15 pra corte + barba (60 min, R$ 70).
          Qual prefere?
Customer: 18:30
Bot:      Fechado! Me diz seu nome pra eu reservar?
Customer: Carlos
Bot:      Confirma corte + barba amanhã (12/07) às 18:30 com João, no valor de R$ 70?
Customer: Confirmo
Bot:      Agendado, Carlos! ✂️ Corte + barba, 12/07 às 18:30 com João.
          Qualquer coisa é só chamar aqui.
```

## Outbound touchpoints (no bot involved)

- **Public page deep link** — "Agendar pelo WhatsApp" button generates `https://wa.me/{shopPhone}?text={context}` where the prefilled message adapts to what the customer already selected (service → professional → date/time), e.g. *"Olá! Quero agendar Corte + Barba dia 12/07 às 18:30 na Barbearia X."* URL-encoded, tested.
- **Confirmation sharing** — after booking on the public page, a "share on WhatsApp" button prefills the appointment summary.

## Failure modes

| Failure | Behavior |
|---|---|
| Evolution container down | Webhook silent; dashboard shows disconnected state; public page/booking unaffected |
| Number disconnected (phone offline/unlinked) | `whatsappStatus = DISCONNECTED`, dashboard prompts re-scan |
| OpenAI error/timeout | Fallback message + `TRANSFERRED_TO_HUMAN`; inbound messages still persisted |
| Duplicate webhook delivery | `WebhookEvent` idempotency — processed once |
| Booking conflict at confirmation time | Bot apologizes, re-fetches slots, offers alternatives |

## Roadmap

- **Official WhatsApp Cloud API** as an alternative adapter (per-tenant Meta business verification) — the pipeline only swaps the transport layer (`sendText`, webhook parsing); orchestrator, tools, and booking rules are untouched.
- Appointment reminders via approved templates.
- Human takeover inbox inside the dashboard.
