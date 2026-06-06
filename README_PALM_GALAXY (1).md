# PALM GALAXY 🌴⚡
### *Dodge the lasers. Survive the city. Every session tracked.*

---

> **Palm Galaxy is a retro arcade game where a palm tree survives laser attacks across the world's most iconic cities. Built lean, deployed fast, data-rich from session zero.**

---

## What It Is

A one-mechanic arcade game. Palm tree. Lasers from left and right. Move or die. Each level is a new city — Miami, Tokyo, NYC, Dubai, Ibiza. The gameplay is simple by design. The backend is not.

Every session is a data event. Every dodge, every death, every share, every email entered — captured, stored, and analyzed. The game funds the bigger vision (ZYVV) by proving what the founder can ship and how fast an audience compounds.

This README documents the full technical architecture: game engine, data layer, AI layer, email layer, Python intelligence stub, deployment, and the tracking philosophy that makes 20 users feel like 2,000.

---

## The Tracking Philosophy

> *"If 20 users tested the game, I want to know exactly what they did, when they left, if they shared their email, if they shared the game via email, and if they shared it on TikTok or X."*

That is the standard. Not analytics. **Intelligence.**

The game is a funnel disguised as entertainment. Every interaction — from first load to game over to share click — feeds a Supabase event log. Groq analyzes behavioral patterns in real time. Resend handles email with surgical precision. Nothing is anonymous unless explicitly opted out.

---

## The Multi-Company Data Flywheel

> *Elon Musk does not build separate audiences. He builds one compounding audience that flows between assets.*

X user data feeds Grok's training. Tesla drivers feed Optimus robot navigation. xAI uses X's social graph. Neuralink's waitlist was seeded from Twitter followers. Every company he builds feeds every other company he builds. The audience compounds. The data compounds. The moat compounds.

Palm Galaxy is built on the same structural logic.

Every session row, behavioral fingerprint, engagement score, and Groq analysis collected by Palm Galaxy lives in Supabase. It never belonged to an email address — the email is just the human-readable label on top of data that was already captured the moment someone loaded the game.

When ZYVV launches, it points at the same Supabase instance. The Palm Galaxy audience does not need to re-identify themselves. ZYVV already knows who engaged, how deeply, how long they played, which city broke them, and what their behavioral profile looks like. The data transfers. The audience transfers. The relationship transfers.

Email is how you reach them. The data is how you already know them before they arrive.

This is not a marketing strategy. It is an architectural decision made at the database level on day one.

---

## Tech Stack

### Frontend / Game Engine
**Vanilla HTML5 Canvas + JavaScript** (prototype, as built)
**Next.js 14 (App Router)** — production version, same stack as ZYVV for shared infra

The game canvas is a `<canvas>` element rendered at 60fps via `requestAnimationFrame`. No game engine dependency. No physics library. Pure browser-native. This keeps the bundle under 50kb and load time under 1 second — critical for TikTok/X link clicks where a 3-second load loses 60% of arrivals.

**Styling:** Tailwind CSS with custom neon CSS variables per city. No design system overhead.

**Fonts:** Google Fonts — Press Start 2P (pixel aesthetic), Orbitron (city labels). Loaded async, fallback to monospace during load.

---

### Backend / Database
**Supabase (PostgreSQL)**

Every user action is a row. No exceptions.

Supabase is chosen because:
- PostgreSQL means real SQL queries against behavioral data
- Row Level Security allows anonymous inserts with zero auth friction
- Realtime subscriptions allow a live dashboard (future)
- pgvector enables AI similarity search across sessions (future)
- Free tier handles thousands of sessions before cost matters
- Same instance shared with ZYVV — one database, two products, one compounding audience

---

### AI Layer
**Groq API — LLaMA 3.1 70B**

Groq is not decoration. It runs real-time analysis on:
- Session behavior as it happens
- Cohort pattern detection across users
- Churn prediction (session about to end)
- Share propensity scoring (is this user about to share?)
- City difficulty calibration (is this level too hard for retention?)

Groq's speed (sub-200ms inference) is a product feature. AI decisions need to happen before the user's next action, not after.

---

### Python Intelligence Layer
**FastAPI — minimal stub at launch, scales into the intelligence layer**

Python is wired in from day one. Not because it is needed now. Because retrofitting it later is expensive and the architecture decision should be made before the data exists, not after.

At launch, the Python service does one thing: receive a daily batch of session data from Supabase and return a summary. That is the entire scope. One file. One endpoint. Deployed as a Vercel serverless function via the Python runtime.

When the data volume justifies it — approximately 500+ sessions — Python grows into its real role without any architectural changes: behavioral clustering, vector embeddings over session data, similarity search via pgvector, and the pattern detection layer that makes ZYVV's collective intelligence possible.

The boundary is identical to ZYVV's architecture:
- **Next.js handles:** UI, routing, Groq API calls, all user-facing logic
- **Python handles:** Pattern detection, vector embeddings, cohort clustering, cross-product intelligence

```
python/
  main.py          ← The entire Python service at launch. One file.
  requirements.txt
```

```python
# python/main.py — minimal stub, wired and ready
# At launch: receives session batch, returns basic summary
# At 500+ sessions: grows into clustering, embeddings, cross-product analysis

from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import os

app = FastAPI()

class SessionSummary(BaseModel):
    session_id: str
    duration_seconds: Optional[int]
    max_level_reached: Optional[int]
    final_score: Optional[int]
    email_captured: Optional[bool]
    shared: Optional[bool]

class BatchInput(BaseModel):
    sessions: List[SessionSummary]
    date: str

@app.get("/health")
def health():
    return { "status": "ok", "service": "palm-galaxy-intelligence" }

@app.post("/analyse/daily-batch")
def analyse_batch(payload: BatchInput):
    """
    Launch behaviour: basic aggregation only.
    Future: sklearn clustering, pgvector embeddings, ZYVV cross-product signals.
    """
    sessions = payload.sessions
    if not sessions:
        return { "summary": "No sessions to analyse." }

    avg_duration = sum(s.duration_seconds or 0 for s in sessions) / len(sessions)
    email_rate = sum(1 for s in sessions if s.email_captured) / len(sessions)
    share_rate = sum(1 for s in sessions if s.shared) / len(sessions)
    avg_score = sum(s.final_score or 0 for s in sessions) / len(sessions)

    return {
        "date": payload.date,
        "total_sessions": len(sessions),
        "avg_duration_seconds": round(avg_duration, 1),
        "email_capture_rate": round(email_rate, 3),
        "share_rate": round(share_rate, 3),
        "avg_final_score": round(avg_score, 1),
        "note": "Stub active. Clustering and embeddings unlock at 500+ sessions."
    }

# ─── FUTURE ENDPOINTS (not yet implemented) ───────────────────────────────────
#
# POST /analyse/cluster-sessions
#   sklearn KMeans over behavioral vectors
#   Returns: player archetypes (casual / competitive / viral)
#
# POST /analyse/embed-session
#   Generates pgvector embedding for a session's behavioral fingerprint
#   Enables: "find sessions similar to this one" across Palm Galaxy + ZYVV
#
# POST /analyse/zyvv-bridge-candidates
#   Scores Palm Galaxy sessions for ZYVV readiness
#   Input: session behavioral data
#   Output: ranked list of sessions most likely to convert to ZYVV
#   This is the cross-product intelligence layer.
#
# ──────────────────────────────────────────────────────────────────────────────
```

```
# python/requirements.txt
fastapi==0.111.0
uvicorn==0.29.0
pydantic==2.7.1
httpx==0.27.0
# Unlocked at 500+ sessions:
# scikit-learn==1.4.2
# numpy==1.26.4
# pandas==2.2.2
# pgvector==0.2.5
# openai==1.30.1  (for embeddings)
```

---

### Email
**Resend + React Email**

Email is the reach mechanism. Not the data. The data already exists in Supabase from session zero — email is how you activate it. A precision instrument:
- Collected at game over with a compelling hook
- Triggers a share-via-email flow (user sends game link to a friend)
- Tracks opens, clicks, and conversions back to game play
- Feeds back into Supabase for full attribution chain

---

### Deployment
**Vercel**

Zero configuration. GitHub push = deploy. Edge functions for low-latency API calls globally. Same deployment infrastructure as ZYVV — one dashboard, one billing account, shared environment variable management.

---

## Database Schema (Supabase)

```sql
-- Enable extensions
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────
-- SESSIONS
-- One row per game load. Created on first paint.
-- Shared with ZYVV via same Supabase instance.
-- ─────────────────────────────────────────
create table sessions (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  fingerprint text,                        -- Browser fingerprint (FingerprintJS)
  ip_hash text,                            -- Hashed IP for geo without PII
  country text,                            -- Derived from IP at edge
  city_geo text,                           -- Geo city (not game city)
  device_type text,                        -- mobile / desktop / tablet
  os text,                                 -- iOS / Android / Windows / macOS
  browser text,
  screen_width int,
  screen_height int,

  -- Acquisition
  referrer text,                           -- Full referrer URL
  utm_source text,                         -- tiktok / x / direct / email
  utm_medium text,
  utm_campaign text,
  utm_content text,                        -- Which specific post/video sent them
  landing_url text,

  -- Timing
  started_at timestamptz default now(),
  last_active_at timestamptz,
  ended_at timestamptz,
  session_duration_seconds int,            -- Computed on session end

  -- Email
  email text,                              -- Null until captured
  email_captured_at timestamptz,
  email_capture_trigger text,              -- 'game_over' / 'share_prompt' / 'level_up'

  -- Share
  shared_tiktok boolean default false,
  shared_x boolean default false,
  shared_email boolean default false,
  shared_link_copied boolean default false,
  share_clicked_at timestamptz,

  -- AI scoring (populated by Groq async)
  engagement_score numeric(4,2),           -- 0-10 Groq-computed engagement rating
  churn_risk text,                         -- 'low' / 'medium' / 'high'
  share_propensity text,                   -- 'low' / 'medium' / 'high'
  groq_session_summary text,              -- Free-text AI summary of this session

  -- Cross-product flags (the data flywheel)
  product_source text default 'palm_galaxy', -- 'palm_galaxy' / 'zyvv' / future products
  zyvv_bridge_sent boolean default false,
  zyvv_bridge_sent_at timestamptz,
  zyvv_converted boolean default false,    -- Did this session eventually use ZYVV?
  zyvv_session_id uuid,                    -- Links to ZYVV session if converted

  created_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- GAME EVENTS
-- Every meaningful in-game moment. Append-only.
-- ─────────────────────────────────────────
create table game_events (
  id bigserial primary key,
  session_id uuid references sessions(id),

  event_type text not null,
  -- Values:
  -- 'game_start'        — user clicks Play
  -- 'game_over'         — palm tree hit
  -- 'level_up'          — city changes
  -- 'laser_dodged'      — near miss (within 30px)
  -- 'laser_hit'         — collision
  -- 'life_lost'         — life decremented
  -- 'pause'             — tab hidden / app backgrounded
  -- 'resume'            — tab refocused
  -- 'share_prompt_seen' — share UI appeared
  -- 'share_clicked'     — share button tapped
  -- 'email_prompt_seen' — email capture appeared
  -- 'email_submitted'   — email entered
  -- 'email_dismissed'   — email prompt closed

  -- Game state at moment of event
  score int,
  level_number int,
  city_name text,
  lives_remaining int,
  palm_x_position int,                     -- 0 to canvas width
  frame_number int,                        -- exact frame of event

  -- For laser events
  laser_side text,                         -- 'left' / 'right'
  laser_y int,                             -- height of laser
  laser_speed numeric(5,2),

  -- For share events
  share_platform text,                     -- 'tiktok' / 'x' / 'email' / 'copy'
  share_recipient_email text,              -- If shared via email

  occurred_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- RUNS
-- One row per game attempt within a session
-- ─────────────────────────────────────────
create table runs (
  id bigserial primary key,
  session_id uuid references sessions(id),
  run_number int,                          -- 1st attempt, 2nd attempt, etc.

  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_seconds int,

  final_score int,
  max_level_reached int,
  max_city_reached text,
  total_lasers_dodged int,
  total_lives_lost int,
  end_reason text,                         -- 'laser_hit' / 'quit' / 'tab_closed'

  email_captured_this_run boolean default false
);

-- ─────────────────────────────────────────
-- EMAIL SHARES (outbound)
-- When a user sends the game link to someone else via Resend
-- ─────────────────────────────────────────
create table email_shares (
  id bigserial primary key,
  session_id uuid references sessions(id),

  sender_email text,
  recipient_email text,
  resend_message_id text,                  -- Resend delivery ID for webhook tracking

  sent_at timestamptz default now(),
  opened_at timestamptz,
  clicked_at timestamptz,
  recipient_played boolean default false,
  recipient_session_id uuid references sessions(id)  -- Full attribution chain
);

-- ─────────────────────────────────────────
-- AI ANALYSIS LOG
-- Every Groq call logged for audit and cost tracking
-- ─────────────────────────────────────────
create table ai_analysis_log (
  id bigserial primary key,
  session_id uuid references sessions(id),

  analysis_type text,
  -- 'session_behavior'       — end-of-session summary
  -- 'churn_prediction'       — mid-session risk scoring
  -- 'share_propensity'       — likelihood to share
  -- 'cohort_pattern'         — pattern across multiple sessions
  -- 'difficulty_calibration' — level design feedback
  -- 'zyvv_bridge_score'      — cross-product conversion readiness

  input_payload jsonb,
  output_payload jsonb,
  tokens_used int,
  latency_ms int,
  model_used text,

  created_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────
alter table sessions enable row level security;
alter table game_events enable row level security;
alter table runs enable row level security;
alter table email_shares enable row level security;
alter table ai_analysis_log enable row level security;

create policy "Public insert sessions"    on sessions    for insert with check (true);
create policy "Public insert game_events" on game_events for insert with check (true);
create policy "Public insert runs"        on runs        for insert with check (true);
create policy "Public update sessions"    on sessions    for update using (true);
create policy "Public update runs"        on runs        for update using (true);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
create index idx_events_session    on game_events(session_id);
create index idx_events_type       on game_events(event_type);
create index idx_events_time       on game_events(occurred_at);
create index idx_sessions_email    on sessions(email) where email is not null;
create index idx_sessions_source   on sessions(utm_source);
create index idx_sessions_product  on sessions(product_source);
create index idx_sessions_zyvv     on sessions(zyvv_converted) where zyvv_converted = true;
create index idx_runs_session      on runs(session_id);
```

---

## Groq Integration — AI Leverage Map

Groq is called at four distinct moments. Each call is logged to `ai_analysis_log`.

### 1. Mid-Session Churn Prediction (fires at 30s, 60s, 90s)
```
Trigger: setTimeout hooks in game loop
Input:   { events_so_far, current_score, level, palm_x_variance, dodge_pattern }
Output:  { churn_risk: 'low|medium|high', recommended_action: string }
Action:  If high churn → trigger email prompt early
         If medium churn → flash a "best score" motivator
         If low churn → do nothing, let the game breathe
```

### 2. Share Propensity Score (fires at game over)
```
Trigger: game_over event
Input:   { final_score, runs_count, cities_reached, session_duration }
Output:  { share_propensity: 'low|medium|high', best_platform: 'tiktok|x|email' }
Action:  Surface the highest-propensity share button first in the UI
```

### 3. End-of-Session Behavioral Summary (fires 5s after last event)
```
Trigger: session_ended (tab close / inactivity)
Input:   { all game_events for session, total runs, email_captured }
Output:  { summary: string, engagement_score: 0-10, notable_behavior: string }
Action:  Written to sessions.groq_session_summary for founder review
```

### 4. Cohort Pattern Analysis (fires daily via Vercel Cron)
```
Trigger: Vercel Cron Job — daily at 03:00 UTC
Input:   { all sessions from last 24h aggregated }
Output:  {
           avg_session_duration,
           top_drop_off_city,
           share_rate_by_source,
           email_capture_rate,
           pattern_summary: string,
           recommended_difficulty_adjustment: string
         }
Action:  Stored in daily_reports table, also sent to Python stub for aggregation
```

---

## Resend Email Architecture

### Email 1 — Capture at Game Over
**Trigger:** User dies, score > 0, `email_prompt_seen` event fires
**Subject:** `Your Palm Galaxy score: {score} 🌴`
**Body:** Score card, share links, "Play again" CTA
**Tracking:** Resend webhook → `sessions.email` populated, `email_captured_at` set

### Email 2 — Share to Friend
**Trigger:** User taps "Send to friend" in post-game UI
**Flow:** User enters recipient email → Resend sends branded invite → webhook tracks open/click → recipient plays → `email_shares.recipient_session_id` linked
**This is the viral loop.** One player sending to one friend is a 2x multiplier with full attribution.

### Email 3 — Day-2 Retention
**Trigger:** Resend scheduled send, 22h after `email_captured_at`
**Subject:** `Can you beat {score+10%}? 🎯`
**Goal:** Return before the 48h churn cliff

### Email 4 — ZYVV Bridge
**Trigger:** Player reaches level 3 or above AND email captured → fires at 48 hours
**Why level 3:** Someone who survived Miami, Tokyo, and NYC earned their curiosity. Session count is a lazy proxy. Level reached is the real signal — it measures depth, not repetition.
**Why 48 hours:** The emotional heat of the experience is still alive. 7 days later the game is forgotten. 48 hours later the dopamine memory is still there.
**Subject:** `You've been dodging lasers. Now dodge something bigger.`
**Body:** Soft intro to ZYVV — same aesthetic, same energy, higher stakes
**Note:** Email is the activation mechanism. The data transfer to ZYVV already happened at the database level from session zero. This email is how you tell them. ZYVV already knows them before they click.

---

## Share Tracking Architecture

### TikTok Share
```
User taps TikTok share →
  1. game_events INSERT: { event_type: 'share_clicked', share_platform: 'tiktok' }
  2. sessions UPDATE: { shared_tiktok: true, share_clicked_at: now() }
  3. Window opens: tiktok.com intent URL with pre-filled caption + game link
  4. UTM link: palmgalaxy.app/?utm_source=tiktok&utm_content={session_id}
  5. When someone clicks that TikTok link:
     → New session with utm_source='tiktok', utm_content={original_session_id}
     → Attribution chain complete: original player → TikTok post → new player
```

### X (Twitter) Share
```
Same flow as TikTok but:
  - Pre-filled tweet: "Level {level} on Palm Galaxy. Can you beat {score}? [link]"
  - UTM: utm_source=x
  - Share card image generated via /api/og (Next.js OG image generation)
```

### Email Share (via Resend)
```
User taps "Send to friend" →
  1. Modal: enter recipient email
  2. POST /api/share-email:
     → Insert email_shares row
     → Resend.send({ from, to: recipient, template: 'game_invite' })
     → resend_message_id stored in email_shares
  3. Resend webhooks (/api/webhooks/resend):
     → email.opened → UPDATE email_shares SET opened_at
     → email.clicked → UPDATE email_shares SET clicked_at
     → Recipient plays → new session with utm_source='email_share'
     → recipient_session_id linked — full chain visible
```

### Link Copy
```
User taps "Copy link" →
  game_events INSERT: { event_type: 'share_clicked', share_platform: 'copy' }
  sessions UPDATE: { shared_link_copied: true }
  Note: No attribution once pasted manually — accepted limitation
```

---

## API Routes (Next.js App Router)

```
/api/session/start          POST   Creates session row, returns session_id
/api/session/event          POST   Inserts game_event row (batched, 500ms debounce)
/api/session/end            POST   Closes session, triggers Groq end analysis
/api/email/capture          POST   Saves email to session, triggers Resend email 1
/api/share/email            POST   Sends invite via Resend, creates email_shares row
/api/webhooks/resend        POST   Handles Resend delivery webhooks (opens, clicks)
/api/og                     GET    Generates score card OG image for social sharing
/api/cron/daily-analysis    POST   Groq cohort analysis + Python batch call (Vercel Cron)
/api/intelligence/batch     POST   Proxies to Python FastAPI stub
```

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Groq
GROQ_API_KEY=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=play@palmgalaxy.app
RESEND_WEBHOOK_SECRET=

# Python Intelligence Service
PYTHON_SERVICE_URL=                 # Internal URL of FastAPI stub

# App
NEXT_PUBLIC_APP_URL=https://palmgalaxy.app
CRON_SECRET=

# Optional: FingerprintJS Pro
NEXT_PUBLIC_FPJS_API_KEY=
```

---

## Project Structure

```
palm-galaxy/
  app/
    page.tsx                        ← Game UI
    api/
      session/
        start/route.ts
        event/route.ts
        end/route.ts
      email/
        capture/route.ts
      share/
        email/route.ts
      webhooks/
        resend/route.ts
      og/route.ts
      cron/
        daily-analysis/route.ts
      intelligence/
        batch/route.ts              ← Proxies to Python stub
  python/
    main.py                         ← Entire Python service at launch
    requirements.txt
  vercel.json
  .env.local
```

---

## What You Know About Every User

If 20 people play the game, here is exactly what exists on each one:

| Data Point | Source | Where Stored |
|---|---|---|
| When they arrived | session.started_at | sessions |
| Where they came from (TikTok / X / email / direct) | utm_source | sessions |
| Which specific post sent them | utm_content | sessions |
| Device / OS / browser | User-Agent parsing | sessions |
| Country / city (geo) | Edge IP detection | sessions |
| Total time played | session_duration_seconds | sessions |
| How many runs | runs COUNT | runs |
| Highest score | MAX(final_score) | runs |
| Which city killed them most | city_name GROUP BY | game_events |
| Every near-miss (30px dodge) | laser_dodged events | game_events |
| Exact frame they died | frame_number on laser_hit | game_events |
| Whether they saw the email prompt | email_prompt_seen event | game_events |
| Whether they dismissed or submitted | email_dismissed / email_submitted | game_events |
| Their email (if captured) | sessions.email | sessions |
| Whether they shared to TikTok | shared_tiktok | sessions |
| Whether they shared to X | shared_x | sessions |
| Whether they sent to a friend | email_shares row | email_shares |
| Whether that friend opened the email | email_shares.opened_at | email_shares |
| Whether that friend played | email_shares.recipient_session_id | email_shares |
| AI engagement score | Groq analysis | sessions.engagement_score |
| AI churn risk at 30/60/90s | Groq analysis | sessions.churn_risk |
| AI behavioral summary | Groq analysis | sessions.groq_session_summary |
| Whether they returned Day 2 | utm_campaign='retention_d2' | sessions |
| Whether they converted to ZYVV | zyvv_converted | sessions |

---

## Deployment

**Zero local setup. Every file created via GitHub browser interface.**

1. Create GitHub repo: `palm-galaxy`
2. Add files using "Add file → Create new file" in GitHub UI
3. Go to vercel.com → New Project → Import repo
4. Add all environment variables in Vercel Settings
5. Add Vercel Cron in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-analysis",
      "schedule": "0 3 * * *"
    }
  ]
}
```

6. Add Resend webhook: `https://palmgalaxy.app/api/webhooks/resend`
7. Every GitHub push = automatic redeploy

---

## Metrics Dashboard (Supabase SQL)

```sql
-- Sessions by source today
select utm_source, count(*) as sessions,
       avg(session_duration_seconds) as avg_duration,
       count(email) as emails_captured
from sessions
where started_at > now() - interval '24 hours'
group by utm_source;

-- Share funnel
select
  count(*) filter (where shared_tiktok) as tiktok_shares,
  count(*) filter (where shared_x) as x_shares,
  count(*) filter (where shared_email) as email_shares,
  count(*) filter (where email is not null) as emails_captured,
  count(*) as total_sessions
from sessions;

-- ZYVV conversion rate from Palm Galaxy audience
select
  count(*) as palm_galaxy_sessions,
  count(*) filter (where zyvv_converted) as converted_to_zyvv,
  round(count(*) filter (where zyvv_converted)::numeric / count(*), 3) as conversion_rate
from sessions
where product_source = 'palm_galaxy';

-- Attribution chain: TikTok virality
select s1.id as original_session, s2.id as referred_session, s2.started_at
from sessions s2
join sessions s1 on s2.utm_content = s1.id::text
where s2.utm_source = 'tiktok';

-- Top drop-off city
select city_name, count(*) as deaths
from game_events
where event_type = 'game_over'
group by city_name
order by deaths desc;

-- ZYVV bridge candidates (level 3+ reached, email captured, bridge not yet sent)
select s.id, s.email, s.engagement_score, max(r.max_level_reached) as best_level
from sessions s
join runs r on r.session_id = s.id
where s.email is not null
  and s.zyvv_bridge_sent = false
  and r.max_level_reached >= 3
group by s.id, s.email, s.engagement_score
order by s.engagement_score desc;
```

---

## Cities (Current + Roadmap)

| Level | City | Sky Palette | Laser Color | Status |
|---|---|---|---|---|
| 1 | Miami | Deep blue / purple | Magenta + Cyan | ✅ Live |
| 2 | Tokyo | Dark violet / navy | Hot pink + Blue | ✅ Live |
| 3 | NYC | Near-black / midnight | Yellow + Orange | ✅ Live |
| 4 | Dubai | Black / dark amber | Gold + Orange | ✅ Live |
| 5 | Ibiza | Ocean black / dark teal | Purple + Pink | ✅ Live |
| 6 | Paris | Dark indigo / slate | White + Violet | Roadmap |
| 7 | Lagos | Deep burnt / dark earth | Green + Amber | Roadmap |
| 8 | Seoul | Black / neon-dark | Red + Cyan | Roadmap |

---

## The Bridge to ZYVV

Palm Galaxy is not the destination. It is the proof of execution and the first node in the data flywheel.

The game demonstrates three things simultaneously: the founder ships fast, the founder instruments a product like a data company, and a qualified audience exists before ZYVV launches.

The data transfer to ZYVV is not a future event. It happened at session zero. Every Palm Galaxy player is already in the same Supabase instance that ZYVV will read from. When ZYVV launches, it does not acquire an audience. It inherits one — with behavioral profiles, engagement scores, and AI summaries already attached.

The ZYVV bridge email at 48 hours (for players who reached level 3+) is simply the moment you tell them what already happened at the data layer. They are already known. The email is the handshake.

The capital will find the idea. The audience finds the founder first.

---

## License

MIT — ship fast, share freely, iterate relentlessly.

---

*Built with: Next.js · Supabase · Groq · Resend · Vercel · Python (FastAPI)*

*Same database. Two products. One compounding audience.*
