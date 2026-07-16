Accessible Park Planner v2 (with OpenAI support)

1. Open a terminal in this folder.
2. Install dependencies:
	npm install
3. Create a .env file using .env.example and set OPENAI_API_KEY.
4. Start the app server:
	npm start
5. Open http://localhost:3000 in your browser.
6. Complete the questionnaire and click Generate itinerary.

Notes:
- Ride suggestion options now load from /api/ride-options using OpenAI.
- Ride suggestion responses are cached on the server and reused in the browser session for repeated park selections.
- AI ride suggestions include ride category, intensity, indoor or outdoor context, transfer guidance, and an accessibility note.
- AI generation runs through /api/generate-day.
- If OPENAI_API_KEY is missing, AI ride suggestions and AI itinerary generation will be unavailable.
- If AI itinerary generation is unavailable, the app falls back to local itinerary logic.
