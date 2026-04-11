"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const openaiApiKey = (0, params_1.defineSecret)('OPENAI_API_KEY');
// ── Firebase Function ──────────────────────────────────────────────────────
exports.generateSummary = (0, https_1.onRequest)({
    secrets: [openaiApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
}, async (req, res) => {
    var _a, _b, _c, _d, _e;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const payload = req.body;
    if (!(payload === null || payload === void 0 ? void 0 : payload.date) || !Array.isArray(payload === null || payload === void 0 ? void 0 : payload.games) || payload.games.length === 0 || !(payload === null || payload === void 0 ? void 0 : payload.prompt)) {
        res.status(400).json({ error: 'Missing required fields: date, games, prompt' });
        return;
    }
    const gamesSummary = payload.games.map((g, i) => {
        const lines = [`${g.awayTeam} vs ${g.homeTeam} — Final: ${g.awayTeam} ${g.awayScore}, ${g.homeTeam} ${g.homeScore}`];
        lines.push('Play by play:');
        for (const ab of g.atBats) {
            let line = `  ${ab.half} ${ab.inning} — ${ab.batter} vs ${ab.pitcher}: ${ab.result}`;
            if (ab.rbi > 0)
                line += `, ${ab.rbi} RBI`;
            if (ab.runnersScored.length > 0)
                line += ` (scored: ${ab.runnersScored.join(', ')})`;
            if (ab.batterAdvancedTo === 'home')
                line += ` [batter scored]`;
            lines.push(line);
        }
        return lines.join('\n');
    }).join('\n\n');
    const prompt = `${payload.prompt}

---
GAME DATA:

${gamesSummary}`;
    let response;
    try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey.value()}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 2000,
            }),
        });
    }
    catch (err) {
        console.error('OpenAI fetch error:', err);
        res.status(502).json({ error: 'Failed to reach OpenAI API' });
        return;
    }
    if (!response.ok) {
        const body = await response.text();
        console.error('OpenAI error response:', response.status, body);
        res.status(502).json({ error: `OpenAI API returned ${response.status}`, details: body });
        return;
    }
    const data = await response.json();
    const text = (_e = (_d = (_c = (_b = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) !== null && _e !== void 0 ? _e : '';
    if (!text) {
        res.status(502).json({ error: 'OpenAI returned an empty response' });
        return;
    }
    res.json({ summary: text });
});
//# sourceMappingURL=index.js.map