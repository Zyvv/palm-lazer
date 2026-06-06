# Palm Lazer — Python Intelligence Service
# python/main.py
#
# FastAPI app — Python 3.11, Pydantic v2.
#
# Routes:
#   GET  /health   → liveness probe
#   POST /analyze  → daily session batch aggregation
#
# Auth: x-api-secret header checked on every request against PYTHON_API_SECRET env var.
# CORS: enabled for NEXT_PUBLIC_APP_URL (falls back to * in dev if not set).
#
# Pure Python aggregation — no external API calls, no ML dependencies.
# Clustering / embeddings unlock at 500+ sessions (see commented stubs at bottom).

import os
from datetime import date
from typing   import List, Optional

import uvicorn
from dotenv           import load_dotenv
from fastapi           import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic          import BaseModel, field_validator

# ─────────────────────────────────────────────────────────────────────────────
# ENV
# ─────────────────────────────────────────────────────────────────────────────

load_dotenv()

PYTHON_API_SECRET   = os.getenv("PYTHON_API_SECRET", "")
NEXT_PUBLIC_APP_URL = os.getenv("NEXT_PUBLIC_APP_URL", "")

# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Palm Lazer Intelligence Service",
    description = "Session batch analysis for Palm Lazer.",
    version     = "1.0.0",
    docs_url    = None,   # disable Swagger UI in production
    redoc_url   = None,
)

# ─────────────────────────────────────────────────────────────────────────────
# CORS
# Allow requests from the Next.js app. Falls back to wildcard in dev when
# NEXT_PUBLIC_APP_URL is not set.
# ─────────────────────────────────────────────────────────────────────────────

cors_origins = [NEXT_PUBLIC_APP_URL] if NEXT_PUBLIC_APP_URL else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins     = cors_origins,
    allow_credentials = False,
    allow_methods     = ["GET", "POST", "OPTIONS"],
    allow_headers     = ["Content-Type", "x-api-secret"],
)

# ─────────────────────────────────────────────────────────────────────────────
# AUTH MIDDLEWARE
# Every request (except OPTIONS preflight) must carry the correct
# x-api-secret header. Returns 403 if missing or wrong.
# ─────────────────────────────────────────────────────────────────────────────

@app.middleware("http")
async def verify_api_secret(request: Request, call_next):
    # Let OPTIONS through for CORS preflight
    if request.method == "OPTIONS":
        return await call_next(request)

    # /health is also protected — callers must pass the secret
    incoming = request.headers.get("x-api-secret", "")

    if not PYTHON_API_SECRET:
        # Secret not configured — reject all requests with a clear message
        return JSONResponse(
            status_code = 500,
            content     = {"error": "PYTHON_API_SECRET is not configured on this server."},
        )

    if incoming != PYTHON_API_SECRET:
        return JSONResponse(
            status_code = 403,
            content     = {"error": "Forbidden: invalid or missing x-api-secret header."},
        )

    return await call_next(request)

# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class SessionSummary(BaseModel):
    session_id:        str
    duration_seconds:  Optional[int]   = None
    final_score:       Optional[int]   = None
    max_level_reached: Optional[int]   = None
    email_captured:    Optional[bool]  = False
    shared:            Optional[bool]  = False


class AnalyzeRequest(BaseModel):
    sessions: List[SessionSummary]


class ChurnDistribution(BaseModel):
    low:    int
    medium: int
    high:   int


class AnalyzeResponse(BaseModel):
    date:               str
    total_sessions:     int
    avg_score:          float
    avg_level:          float
    churn_distribution: ChurnDistribution
    share_rate:         float
    email_capture_rate: float
    top_city:           str
    note:               str

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Maps max_level_reached → city name (mirrors ACTIVE_CITIES order in cities.ts)
CITY_BY_LEVEL: dict[int, str] = {
    0: "Miami",
    1: "Tokyo",
    2: "NYC",
    3: "Dubai",
    4: "Ibiza",
}

# Churn thresholds in seconds
CHURN_HIGH_MAX   = 30    # < 30s  → high churn
CHURN_MEDIUM_MAX = 90    # 30–90s → medium churn
                         # > 90s  → low churn

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def classify_churn(duration_seconds: Optional[int]) -> str:
    """
    Bucket a session's churn risk based on play duration.
    None / missing duration → high (never engaged enough to record time).
    """
    if duration_seconds is None:
        return "high"
    if duration_seconds < CHURN_HIGH_MAX:
        return "high"
    if duration_seconds <= CHURN_MEDIUM_MAX:
        return "medium"
    return "low"


def derive_top_city(sessions: List[SessionSummary]) -> str:
    """
    Returns the city name most frequently reached by the cohort.
    Uses max_level_reached distribution; ties broken by insertion order.
    Falls back to Miami if no sessions or all levels are None.
    """
    counts: dict[str, int] = {}
    for s in sessions:
        level = s.max_level_reached if s.max_level_reached is not None else 0
        # Cap at max known city index
        level = max(0, min(level, len(CITY_BY_LEVEL) - 1))
        city  = CITY_BY_LEVEL[level]
        counts[city] = counts.get(city, 0) + 1

    if not counts:
        return "Miami"

    return max(counts, key=lambda c: counts[c])

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Liveness probe. Returns 200 if the service is up."""
    return {"status": "ok", "service": "palm-lazer-intelligence"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    Aggregate a batch of session summaries and return cohort statistics.

    Called daily by /api/cron/daily-analysis (Next.js) via
    /api/intelligence/batch proxy route.

    No external API calls — pure Python aggregation.
    """
    sessions = payload.sessions
    n        = len(sessions)

    today = date.today().isoformat()

    if n == 0:
        return AnalyzeResponse(
            date               = today,
            total_sessions     = 0,
            avg_score          = 0.0,
            avg_level          = 0.0,
            churn_distribution = ChurnDistribution(low=0, medium=0, high=0),
            share_rate         = 0.0,
            email_capture_rate = 0.0,
            top_city           = "Miami",
            note               = "No sessions to analyse.",
        )

    # ── Score + level averages ────────────────────────────────────────────────
    avg_score = sum(s.final_score or 0 for s in sessions) / n
    avg_level = sum(s.max_level_reached or 0 for s in sessions) / n

    # ── Churn distribution ────────────────────────────────────────────────────
    churn_counts: dict[str, int] = {"low": 0, "medium": 0, "high": 0}
    for s in sessions:
        bucket = classify_churn(s.duration_seconds)
        churn_counts[bucket] += 1

    churn_distribution = ChurnDistribution(
        low    = churn_counts["low"],
        medium = churn_counts["medium"],
        high   = churn_counts["high"],
    )

    # ── Share + email rates ───────────────────────────────────────────────────
    share_count = sum(1 for s in sessions if s.shared)
    email_count = sum(1 for s in sessions if s.email_captured)

    share_rate         = share_count / n
    email_capture_rate = email_count / n

    # ── Top city ──────────────────────────────────────────────────────────────
    top_city = derive_top_city(sessions)

    # ── Note ──────────────────────────────────────────────────────────────────
    note = (
        f"Cohort of {n} sessions. "
        f"Avg score {avg_score:.0f}. "
        f"Email rate {email_capture_rate:.1%}. "
        f"Share rate {share_rate:.1%}."
    )

    return AnalyzeResponse(
        date               = today,
        total_sessions     = n,
        avg_score          = round(avg_score, 2),
        avg_level          = round(avg_level, 2),
        churn_distribution = churn_distribution,
        share_rate         = round(share_rate, 4),
        email_capture_rate = round(email_capture_rate, 4),
        top_city           = top_city,
        note               = note,
    )


# ─────────────────────────────────────────────────────────────────────────────
# FUTURE ENDPOINTS — unlock at 500+ sessions
# ─────────────────────────────────────────────────────────────────────────────
#
# POST /cluster-sessions
#   sklearn KMeans over behavioural vectors
#   Returns: player archetypes (casual / competitive / viral)
#
# POST /embed-session
#   Generates pgvector embedding for a session's behavioural fingerprint
#   Enables: "find sessions similar to this one" across Palm Lazer + ZYVV
#
# POST /zyvv-bridge-candidates
#   Scores Palm Lazer sessions for ZYVV readiness
#   Input: session behavioural data
#   Output: ranked list of sessions most likely to convert to ZYVV
#   This is the cross-product intelligence layer.
#
# Unlock by adding to requirements.txt:
#   scikit-learn==1.5.0
#   numpy==1.26.4
#   pandas==2.2.2
#   pgvector==0.2.5
#   openai==1.30.1   # for text-embedding-3-small
#
# ─────────────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
