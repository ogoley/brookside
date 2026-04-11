# Wiffle Ball Overlay — Architecture Diagrams

> Open this file in VS Code (`Ctrl+Shift+V`) with the Mermaid Preview extension to see rendered diagrams.
> Text reference: see `ARCHITECTURE.md` in the project root.

---

## 1. System Overview — Routes & Devices

```mermaid
graph LR
    OBS["OBS - 1920x1080"]
    Tablet["Producer Tablet"]
    Phone["Scorekeeper Phone"]
    Browser["Public Browser"]
    Admin["Admin Browser"]

    OBS -->|reads| OVERLAY["/overlay - OverlayRoute"]
    Tablet -->|reads + writes| CTRL["/controller - ControllerRoute"]
    Phone -->|reads + writes| SK["/scorekeeper - ScorekeeperRoute"]
    Browser -->|reads| STATS["/stats - StatsRoute"]
    Admin -->|reads + writes| GE["/game-editor - GameEditorRoute"]

    OVERLAY -->|listens| FB[(Firebase Realtime DB)]
    CTRL -->|listens + writes| FB
    SK -->|listens + writes| FB
    STATS -->|listens| FB
    GE -->|listens + writes| FB
```

---

## 2. Live Game Data Flow

```mermaid
sequenceDiagram
    participant SK as ScorekeeperRoute
    participant FB as Firebase
    participant OV as OverlayRoute
    participant CT as ControllerRoute

    SK->>FB: push /gameStats/{gameId}/{atBatId}
    SK->>FB: set /liveRunners/{gameId}
    SK->>FB: update /games/{gameId} (outs, scores, inning)
    SK->>FB: update /game/meta (if isStreamed)
    SK->>FB: update /game/matchup (pitcherId, batterId)

    FB-->>OV: onValue → useGameData, useMatchup, useOverlayState
    FB-->>CT: onValue → useGameRecord, useLiveRunners
    FB-->>SK: onValue → useGameRecord, useLiveRunners

    Note over OV: Read-only — never writes Firebase
```

---

## 3. Firebase Schema Tree

```mermaid
graph TD
    ROOT[Firebase Root]

    ROOT --> CONFIG["/config"]
    CONFIG --> LOGO["leagueLogo: string"]

    ROOT --> GAME["/game"]
    GAME --> META["meta - GameMeta: scores, inning, outs, bases, teamIds"]
    GAME --> MATCHUP["matchup - MatchupState: batterId, pitcherId, lastPitcher x2"]

    ROOT --> TEAMS["/teams/{teamId}"]
    TEAMS --> TEAM_FIELDS["name, shortName, primaryColor, secondaryColor, logoUrl"]

    ROOT --> PLAYERS["/players/{playerId}"]
    PLAYERS --> P_BASE["name, teamId, jerseyNumber"]
    PLAYERS --> P_STATS["stats/"]
    P_STATS --> HITTING["hitting - HittingStats: gp pa ab h 2B 3B HR R RBI BB K AVG OBP SLG OPS"]
    P_STATS --> PITCHING["pitching - PitchingStats: gp IP K BB RA ERA W L"]

    ROOT --> OVERLAY["/overlay - OverlayState"]
    OVERLAY --> SCENE["activeScene"]
    OVERLAY --> STATOV["statOverlay: visible, type, playerId, dismissAfterMs"]
    OVERLAY --> TIMER["timer: durationMs, startedAt, running"]
    OVERLAY --> HOMERUN["homerun: active, teamSide, playerId, runsScored"]

    ROOT --> GAMES["/games/{gameId} - GameRecord"]
    GAMES --> G_META["homeTeamId, awayTeamId, date, finalized, isStreamed, startedAt"]
    GAMES --> G_SCORES["homeScore, awayScore, wPitcherId, lPitcherId"]
    GAMES --> G_STATE["inning, isTopInning, outs"]
    GAMES --> LINEUPS["lineups/{teamId} - LineupEntry[]"]
    GAMES --> LINEUP_POS["lineupPosition/{teamId} - int"]

    ROOT --> GAMESTATS["/gameStats/{gameId}/{atBatId} - AtBatRecord"]
    GAMESTATS --> AB_FIELDS["batterId, pitcherId, isSub, inning, isTopInning, timestamp, result, outsOnPlay, rbiCount, batterAdvancedTo, runnersScored[]"]
    GAMESTATS --> AB_RUNNERS["runnersOnBase - snapshot before play; runnerOutcomes - what happened to each runner"]

    ROOT --> LIVERUNNERS["/liveRunners/{gameId} - RunnersState: first, second, third"]

    ROOT --> SUMMARIES["/gameSummaries/{gameId}/{playerId} - GameSummary"]
    SUMMARIES --> SUM_HIT["ab, pa, h, 2B, 3B, HR, R, RBI, BB, K"]
    SUMMARIES --> SUM_PITCH["inningsPitched, pitchingK, pitchingBb, runsAllowed"]
```

---

## 4. Data Tier Architecture — What Is Stored vs Derived

This answers: where does data flow, what gets written vs computed, and where do season stats come from.

```mermaid
flowchart TD
    subgraph TIER1["Tier 1 — Source of Truth (written live)"]
        AB["/gameStats/{gameId}/{atBatId}<br/>AtBatRecord — every plate appearance"]
    end

    subgraph TIER2["Tier 2 — Live Game Cache (written after each at-bat)"]
        LR["/liveRunners/{gameId}<br/>RunnersState — who is on base right now"]
        GC["/games/{gameId}<br/>running score, outs, inning"]
    end

    subgraph TIER3["Tier 3 — Finalized Snapshots (written on finalization only)"]
        GS["/gameSummaries/{gameId}/{playerId}<br/>GameSummary — per-game box score"]
        PS["/players/{id}/stats/hitting<br/>/players/{id}/stats/pitching<br/>Season totals — rewritten from ALL summaries"]
    end

    AB -->|replay engine after each submit| LR
    AB -->|cached running totals| GC
    AB -->|computeGameStats on finalization| GS
    GS -->|recalcSeasonStats reads ALL games| PS

    subgraph READERS["Who reads what"]
        STATS_PAGE["StatsRoute<br/>derives everything from gameSummaries<br/>does NOT use players/stats"]
        OVERLAY["Live Stat Overlay<br/>reads players/stats for season context<br/>+ computeGameStats on live at-bats<br/>+ mergeHittingStats to combine"]
        SK_PANEL["Scorekeeper live panel<br/>derives from current game at-bats only"]
    end

    GS -->|direct aggregation| STATS_PAGE
    PS -->|stored season totals| OVERLAY
    AB -->|current game computed live| OVERLAY
    AB -->|replay engine| SK_PANEL
```

**Key facts:**
- `/players/{id}/stats` is a **write-through cache** — always recomputed from all `gameSummaries` at finalization time. Never manually edited.
- `StatsRoute` ignores `/players/{id}/stats` entirely and re-derives from `gameSummaries` on every load.
- The live overlay is the only consumer that uses stored season stats — it needs them without fetching every game's raw at-bats.
- A player's season stats are only as current as the last finalization. Mid-season live games only appear in the overlay's stat card (via merge), not in the stats page until finalized.

---

## 5. Game Finalization Flow

Finalization runs entirely client-side in `GameEditorRoute`. It is a multi-path Firebase `update()` call — all writes happen atomically in one batch.

```mermaid
flowchart TD
    A(["Admin taps Finalize in GameEditorRoute"]) --> B["Read all at-bats from gameStats/{gameId}"]
    B --> C["computeGameStats per player<br/>src/scoring/engine.ts — pure function"]
    C --> D["Build GameSummary for each player<br/>ab, pa, h, 2B, 3B, HR, R, RBI, BB, K, IP, RA"]
    D --> E["Write /gameSummaries/{gameId}/{playerId}"]
    E --> F["recalcSeasonStats<br/>Read ALL /gameSummaries across all finalized games"]
    F --> G["Aggregate counting stats per player<br/>gp, pa, ab, h, 2B, 3B, HR, R, RBI, BB, K, IP, K, BB, RA"]
    G --> H["Derive rate stats<br/>AVG = H/AB, OBP = H+BB/PA, ERA = RA/IP x 7"]
    H --> I["Write /players/{id}/stats/hitting — season totals overwritten"]
    H --> J["Write /players/{id}/stats/pitching — season totals overwritten"]
    D --> K["Write /games/{gameId}/finalized = true"]
    D --> L["Write /games/{gameId}/homeScore + awayScore"]
```

**Note on architecture:** All this logic runs in the browser. For an internal tool this is acceptable, but the risk is a partial write if the tab closes mid-finalization. A Firebase Cloud Function would eliminate that risk and keep the logic off the client. Not urgent, but worth noting for future.

---

## 6. Game Editor — Save Flow

```mermaid
flowchart TD
    A(["User edits box score cells"]) --> B["Local edits state — not yet in Firebase"]
    B --> C(["Save and Update Season Stats"])
    C --> D["Merge edits into game summaries"]
    D --> E["Auto-compute PA = AB + BB if PA is 0"]
    E --> F["Derive scores: homeScore = sum of R for home team batters"]
    F --> G["Write /gameSummaries/{gameId}/{playerId}"]
    F --> H["Write /games/{gameId}/homeScore, awayScore, wPitcherId, lPitcherId"]
    G --> I["recalcSeasonStats: sum ALL gameSummaries across all games"]
    I --> J["Write /players/{id}/stats/hitting"]
    I --> K["Write /players/{id}/stats/pitching — preserves W/L via spread"]
    K --> L{"W/L assignment changed?"}
    L -->|Yes| M["Apply delta: subtract old W or L, add new W or L"]
    L -->|No| N(["Done"])
    M --> N
```

---

## 7. Scorekeeper At-Bat Wizard

```mermaid
stateDiagram-v2
    [*] --> batter: Game loaded
    batter --> result: Batter selected
    result --> runners: Result requires runner decisions (hit with runners on, groundout chain rule)
    result --> confirm: Auto-resolved (K, Kl, BB, HR with no runners)
    runners --> confirm: Runner outcomes set
    confirm --> batter: submit() — writes at-bat to Firebase, advances lineup position
    confirm --> inning_end: outs >= 3
    inning_end --> batter: advanceHalfInning() — resets outs, flips inning, restores pitcher
    batter --> batter: undoLastAtBat() — deletes last record, replays half-inning
```

---

## 8. Innings Pitched Round-Trip

```mermaid
flowchart LR
    A["User types: 5.2"] --> B["parseIpInput: full=5, partial=2, outs = 17"]
    B --> C["Store as true decimal: 5 + 2/3 = 5.6666..."]
    C --> D["Firebase write: inningsPitched: 5.6666..."]
    D --> E["formatIp: full=5, partial=round(0.666x3)=2, display 5.2"]
    E --> F["Season recalc: Math.round(5.6666 x 3) = 17 outs, sum with other games"]
```

---

## 9. Component Relationships (Overlay)

```mermaid
graph TD
    OR["OverlayRoute — 1920x1080 canvas"]
    AP["AnimatePresence — scene switcher"]
    OR --> AP

    AP --> GS[GameScene]
    AP --> SC[StatCardScene]
    AP --> IS[IdleScene]
    AP --> MS[MatchupScene]
    AP --> STS[StandingsScene]
    AP --> LS[LeaderboardScene]
    AP --> INS[InsightsScene]

    GS --> SB["Scoreboard — pill layout, centered 36% width"]
    GS --> SOV["StatOverlay — Framer Motion slide-up, auto-dismiss timer"]
    SB --> BD[BaseDiamond]
    SB --> PN_BAT["PlayerNotch — Batter"]
    SB --> PN_PIT["PlayerNotch — Pitcher"]
    SB --> TIMER_NOTCH["Timer notch — absolutely positioned below center"]

    TCI["TeamColorInjector — injects CSS vars on root"] -.->|"--team-home-primary etc"| OR
```
