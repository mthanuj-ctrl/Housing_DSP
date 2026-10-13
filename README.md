# Real-Time Housing Price Prediction and Neighborhood Affordability Clustering

A production-ready full-stack application built on the OSEMN framework
(Obtain, Scrub, Explore, Model, Interpret) for Indian real estate intelligence.

## Architecture

| Component | Technology | Hosting | Free Tier |
|-----------|-----------|---------|-----------|
| Frontend | HTML5, CSS3, Vanilla JS, Leaflet.js | Netlify | Yes, no credit card |
| Backend AI | Python, FastAPI, Google Gemini | Hugging Face Spaces (Docker) | Yes, no credit card |
| ML Engine | R, Shiny, caret, cluster | shinyapps.io | Yes, 25 active hours/month |

## Features

1. **Locality Search and Real Estate Metrics Dashboard**
   - Query any Indian locality (Koramangala, Whitefield, Gachibowli, Andheri, etc.)
   - Live price-per-square-foot rates and core terminology definitions.

2. **Predictive Horizon Engine**
   - Forecasts at 6 months, 2 years, and 5 years using compound appreciation formulas.

3. **Interactive Spatial Mapping**
   - Leaflet OpenStreetMap with pins color-coded by K-Means affordability tiers
   - Interactive popups with price, configuration, and proximity indicators.

4. **Google Gemini AI Assistant**
   - Context-aware investment insights, risk analysis, and market outlook.

5. **Alternative Smart Recommendations**
   - Nearby localities with superior price-to-value ratios.

## Prerequisites

- Node.js (optional, for local frontend preview)
- Python 3.11+ (for local backend testing)
- R 4.3+ with RStudio (for local Shiny engine testing)
- Git
- Accounts: GitHub, Netlify, Hugging Face, shinyapps.io, Google AI Studio

## Quick Start (Local Development)

### Backend

```bash
cd backend
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
uvicorn backend:app --host 0.0.0.0 --port 7860 --reload