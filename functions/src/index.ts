import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

const openaiApiKey = defineSecret('OPENAI_API_KEY')

// ── Types ──────────────────────────────────────────────────────────────────

interface AtBatEntry {
  batter: string
  pitcher: string
  result: string
  inning: number
  half: 'top' | 'bot'
  rbi: number
  outsOnPlay: number
  batterAdvancedTo: string | null
  runnersScored: string[]
}

interface GameData {
  awayTeam: string
  homeTeam: string
  awayScore: number
  homeScore: number
  atBats: AtBatEntry[]
}

interface SummaryPayload {
  date: string
  games: GameData[]
  prompt: string
}

// ── Firebase Function ──────────────────────────────────────────────────────

export const generateSummary = onRequest(
  {
    secrets: [openaiApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const payload = req.body as SummaryPayload

    if (!payload?.date || !Array.isArray(payload?.games) || payload.games.length === 0 || !payload?.prompt) {
      res.status(400).json({ error: 'Missing required fields: date, games, prompt' })
      return
    }

    const gamesSummary = payload.games.map((g, i) => {
      const lines = [`${g.awayTeam} vs ${g.homeTeam} — Final: ${g.awayTeam} ${g.awayScore}, ${g.homeTeam} ${g.homeScore}`]
      lines.push('Play by play:')
      for (const ab of g.atBats) {
        let line = `  ${ab.half} ${ab.inning} — ${ab.batter} vs ${ab.pitcher}: ${ab.result}`
        if (ab.rbi > 0) line += `, ${ab.rbi} RBI`
        if (ab.runnersScored.length > 0) line += ` (scored: ${ab.runnersScored.join(', ')})`
        if (ab.batterAdvancedTo === 'home') line += ` [batter scored]`
        lines.push(line)
      }
      return lines.join('\n')
    }).join('\n\n')

    const prompt = `${payload.prompt}

---
GAME DATA:

${gamesSummary}`

    let response: Response
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
      })
    } catch (err) {
      console.error('OpenAI fetch error:', err)
      res.status(502).json({ error: 'Failed to reach OpenAI API' })
      return
    }

    if (!response.ok) {
      const body = await response.text()
      console.error('OpenAI error response:', response.status, body)
      res.status(502).json({ error: `OpenAI API returned ${response.status}`, details: body })
      return
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) {
      res.status(502).json({ error: 'OpenAI returned an empty response' })
      return
    }

    res.json({ summary: text })
  }
)
