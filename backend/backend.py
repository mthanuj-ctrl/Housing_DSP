"""
Real-Time Housing Price Prediction & Neighborhood Affordability Clustering
FastAPI Backend with Google Gemini API Integration
Deploy target: Hugging Face Spaces (Docker SDK)
"""

import os
import re
from datetime import datetime
from typing import Optional, List

import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY environment variable is not set. "
        "Set it in Hugging Face Space Secrets."
    )

genai.configure(api_key=GEMINI_API_KEY)
MODEL_NAME = "gemini-2.0-flash-exp"
model = genai.GenerativeModel(MODEL_NAME)

app = FastAPI(
    title="Housing Price Prediction API",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class InsightRequest(BaseModel):
    locality: str
    city: str
    price_per_sqft: float
    bhk: Optional[str] = None
    property_type: Optional[str] = "Apartment"
    user_query: Optional[str] = None

class RecommendRequest(BaseModel):
    locality: str
    city: str
    current_price_per_sqft: float
    budget_max: Optional[float] = None
    preferred_bhk: Optional[str] = "2BHK"

class PredictRequest(BaseModel):
    locality: str
    city: str
    current_price_per_sqft: float
    appreciation_rate_annual: float = 0.06

class CorrectRequest(BaseModel):
    query: str
    city: Optional[str] = None

class NearbyRequest(BaseModel):
    locality: str
    city: str
    lat: float
    lng: float
    radius_km: float = 15.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def calculate_forecast(current_price: float, annual_rate: float) -> dict:
    horizons = {"6_months": 0.5, "2_years": 2.0, "5_years": 5.0}
    result = {}
    for label, years in horizons.items():
        future = current_price * ((1 + annual_rate) ** years)
        result[label] = {
            "years": years,
            "projected_price_per_sqft": round(future, 2),
            "absolute_gain": round(future - current_price, 2),
            "percent_gain": round(((future - current_price) / current_price) * 100, 2),
        }
    return result

def sanitize_line(text: str) -> str:
    """Strip quotes, explanations, and trailing punctuation from a model response."""
    text = text.strip()
    text = re.sub(r"^[\"'`]+|[\"'`]+$", "", text)
    text = text.split("\n")[0].strip()
    text = re.sub(r"^\s*(corrected|answer|name)\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    return text.strip(" .,:;")

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "housing-price-prediction-api",
        "model": MODEL_NAME,
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.post("/api/insights")
async def get_insights(req: InsightRequest):
    context = (
        f"Locality: {req.locality}\n"
        f"City: {req.city}\n"
        f"Current Price per Sq.Ft: INR {req.price_per_sqft:.0f}\n"
        f"BHK Configuration: {req.bhk or 'Not specified'}\n"
        f"Property Type: {req.property_type}\n"
    )

    prompt = f"""You are an expert Indian real estate analyst. Analyze the following property locality data and provide actionable investment intelligence.

{context}

Provide your response in this exact structure:

INVESTMENT_RATING: <score from 1 to 10>

SUMMARY:
<2-3 sentence summary of the locality's current real estate standing.>

KEY_STRENGTHS:
- <strength 1>
- <strength 2>
- <strength 3>

RISK_FACTORS:
- <risk 1>
- <risk 2>
- <risk 3>

INFRASTRUCTURE_NOTES:
<Brief paragraph on connectivity, schools, hospitals, and upcoming infrastructure.>

MARKET_OUTLOOK:
<Brief paragraph on the 2-year and 5-year outlook.>

Do not use emojis, em dashes, or markdown. Use plain text with the exact labels above. Be specific to the Indian real estate market context."""

    if req.user_query:
        prompt += f"\n\nADDITIONAL USER QUESTION: {req.user_query}\nAnswer this question within the relevant section above."

    try:
        response = model.generate_content(prompt)
        return {
            "success": True,
            "locality": req.locality,
            "city": req.city,
            "raw_response": response.text,
            "model": MODEL_NAME,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/correct")
async def correct_spelling(req: CorrectRequest):
    """
    Fix spelling mistakes and normalise informal Indian locality names.
    Falls back to the original query if the model cannot confidently correct it.
    """
    prompt = f"""You are a spelling normaliser for Indian real estate locality names.

User typed: "{req.query}"
City context: {req.city or 'not specified'}

Rules:
- If the input matches (or is close to) a real Indian locality, return the correctly spelled locality name.
- If the input is a neighbourhood abbreviation (e.g. "koramangla", "whitefeild", "gachiboli"), fix it.
- Return ONLY the corrected locality name on a single line.
- Do not include quotes, explanations, punctuation, or labels like "Corrected:".
- If the input is already correct or cannot be recognised, return it exactly as given.

Corrected locality:"""

    try:
        response = model.generate_content(prompt)
        corrected = sanitize_line(response.text)
        # Safety: if the model returned something absurdly long, keep original
        if not corrected or len(corrected) > 60:
            corrected = req.query
        return {
            "original": req.query,
            "corrected": corrected,
            "changed": corrected.lower() != req.query.lower(),
        }
    except Exception as e:
        # Fail gracefully; frontend will proceed with the raw query
        return {
            "original": req.query,
            "corrected": req.query,
            "changed": False,
            "error": str(e),
        }


@app.post("/api/nearby")
async def get_nearby(req: NearbyRequest):
    """
    Return 5 real nearby localities around a geocoded point, with estimated
    price per sq.ft. and a short value commentary. Coordinates are returned as
    null and are geocoded on the frontend via Nominatim.
    """
    prompt = f"""You are an Indian real estate market analyst.

Reference locality: {req.locality}
City: {req.city}
Approximate coordinates: latitude {req.lat:.4f}, longitude {req.lng:.4f}
Search radius: within {req.radius_km:.0f} km

List exactly 5 real nearby localities (suburbs, neighbourhoods, or micro-markets) that a home buyer would realistically compare against {req.locality}.

For each locality output one block using EXACTLY this format, separated by a blank line:

LOCALITY: <name>
ESTIMATED_PRICE_PER_SQFT: <integer INR value>
BHK_MIX: <e.g. 2BHK and 3BHK>
VALUE_NOTE: <one sentence on relative value and appreciation outlook>

Rules:
- Do not use markdown, emojis, or em dashes.
- Do not include any text outside the 5 blocks.
- Use realistic 2024-2025 price estimates for {req.city}.
- Every locality must be within {req.radius_km:.0f} km of the reference point."""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()

        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if "LOCALITY:" in b]
        results: List[dict] = []
        for block in blocks[:5]:
            name = None
            price = None
            bhk = None
            note = None
            for line in block.split("\n"):
                line = line.strip()
                if line.upper().startswith("LOCALITY:"):
                    name = line.split(":", 1)[1].strip()
                elif line.upper().startswith("ESTIMATED_PRICE_PER_SQFT:"):
                    raw = line.split(":", 1)[1].strip()
                    m = re.search(r"\d[\d,]*", raw)
                    price = int(m.group(0).replace(",", "")) if m else None
                elif line.upper().startswith("BHK_MIX:"):
                    bhk = line.split(":", 1)[1].strip()
                elif line.upper().startswith("VALUE_NOTE:"):
                    note = line.split(":", 1)[1].strip()

            if name and price:
                results.append({
                    "locality": name,
                    "estimated_price_per_sqft": price,
                    "bhk_mix": bhk or "2BHK and 3BHK",
                    "value_note": note or "",
                })

        return {
            "success": True,
            "reference": req.locality,
            "city": req.city,
            "nearby": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/recommend")
async def get_recommendations(req: RecommendRequest):
    prompt = f"""You are an Indian real estate market analyst. A user is looking at properties in {req.locality}, {req.city} at INR {req.current_price_per_sqft:.0f} per sq.ft.

Preferred configuration: {req.preferred_bhk}. Budget maximum: {req.budget_max or 'Not specified'}.

Recommend 4 alternative nearby localities within the same city. For each, provide:

LOCALITY_NAME: <name>
CITY: <city>
ESTIMATED_PRICE_PER_SQFT: <INR value>
VALUE_SCORE: <1-10>
APPRECIATION_OUTLOOK: <Brief forecast rationale>
PROXIMITY_KM: <approx distance from {req.locality} in km>

Format each as a separate block. No emojis, em dashes, or markdown. Realistic estimates for {req.city}."""

    try:
        response = model.generate_content(prompt)
        return {
            "success": True,
            "base_locality": req.locality,
            "city": req.city,
            "raw_response": response.text,
            "model": MODEL_NAME,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/api/predict")
async def predict_price(req: PredictRequest):
    forecast = calculate_forecast(req.current_price_per_sqft, req.appreciation_rate_annual)
    return {
        "success": True,
        "locality": req.locality,
        "city": req.city,
        "current_price_per_sqft": req.current_price_per_sqft,
        "annual_appreciation_rate": req.appreciation_rate_annual,
        "forecast": forecast,
        "method": "compound_annual_growth",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/glossary")
def get_glossary():
    return {
        "terms": [
            {"term": "Carpet Area", "definition": "The actual usable floor area within the walls of an apartment, excluding common areas, balconies, and external walls. RERA mandates disclosure of carpet area."},
            {"term": "Built-up Area", "definition": "Carpet area plus the area of walls and balconies. Typically 10-15 percent larger than carpet area."},
            {"term": "Super Built-up Area", "definition": "Built-up area plus a proportionate share of common amenities such as lobbies, staircases, and elevators. Can be 20-30 percent larger than carpet area."},
            {"term": "Guidance Value", "definition": "The minimum price per sq.ft. set by state governments for stamp duty calculation. Market rates may be higher."},
            {"term": "Circle Rate", "definition": "Another term for guidance value, used in Delhi and some other states. Property cannot be registered below this rate."},
            {"term": "RERA", "definition": "Real Estate (Regulation and Development) Act, 2016. Establishes state-level regulatory authorities for real estate projects and agents."},
            {"term": "Floor Space Index (FSI)", "definition": "The ratio of a building's total floor area to the size of the plot on which it is built. Also called Floor Area Ratio (FAR)."},
            {"term": "Occupancy Certificate (OC)", "definition": "A document issued by the local municipal authority certifying that a building is fit for occupation. Essential for utility connections."},
        ]
    }