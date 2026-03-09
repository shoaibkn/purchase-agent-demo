# Purchase Agent Demo

Next.js demo for manufacturing procurement workflows with a context-aware purchase agent.

## Stack

- Next.js App Router + TypeScript
- Prisma ORM with Neon Postgres
- LangChain + OpenAI
- Simulated in-app email threads for supplier communication

## Getting started

1. Install dependencies:
   - `npm install`
2. Configure environment:
   - `cp .env.example .env`
   - Set your Neon `DATABASE_URL` and `OPENAI_API_KEY`
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Create migration:
   - `npm run prisma:migrate -- --name init`
5. Seed sample data:
   - `npm run prisma:seed`
6. Run local app:
   - `npm run dev`

## Current scaffold

- Domain schema with suppliers, materials, purchase orders, line-level EDD, commitments, simulated emails, reminders, and agent runs
- Route placeholders for PO APIs, simulated inbound email, and cron jobs
- Page placeholders for dashboard, suppliers, materials, purchase orders, communications, and settings
