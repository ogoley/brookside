/**
 * voting/ballot2026.ts — the 2026 awards ballot as agreed by the commissioners
 * (2026-10-14). Finalist lists came from the shared "Award Finalists 2026"
 * checklist. Applied to /voting/awards by the "Apply 2026 ballot" button in
 * /vote-admin → Awards (replaces the whole award list).
 *
 * Next year: copy this file, change the lists, point the button at it.
 */
import type { AwardsMap } from '../types'
import { STARTER_AWARDS } from './logic'

const ROOKIES = [
    'dan_bergeron',
    'al_bishop',
    '-OtHHi8_0L8Ht_9i3Ian',
    'ryan_cassidy',
    'tom_davis',
    'thaida_duong',
    'christian_damour',
    'daniel_ferguson',
    'rick_hastings',
    'steve_holstrom',
    '-OtHHZTZG-3lDFkt196W',
    'james_martin',
    'jake_mastorakis',
    'matt_pellegrino',
    'chris_ryan',
    'adam_sapowsky',
    'alex_serrazina',
    'jason_williams',
    'jeff_witek',
    'joe_zguro',
]

const VALUE_PICKS = [
    'dan_bergeron',
    'brian_bergeron',
    'thai_bui',
    'ryan_cassidy',
    'jon_chappel',
    'thaida_duong',
    'daniel_ferguson',
    'christopher_frappier',
    'josh_griffith',
    'steve_holstrom',
    'joe_hutchison',
    'anthony_mazzaferro',
    'brendan_mcdonald',
    'jason_menard',
    'mark_pafumi',
    'matt_pellegrino',
    'chris_ryan',
    'adam_sapowsky',
    'michael_schoen',
    'alex_serrazina',
    'lids_venancio',
    'joe_zguro',
]

const UMPS = [
    'al_bishop',
    'thai_bui',
    'christian_damour',
    'casey_edgar',
    'brian_harrigan',
    'eric_hiller',
    'rick_holden',
    'rob_holden',
    'jason_menard',
    'denny_nelson',
    'kris_oconnor',
    'tom_ogoley',
    'dragon_ogoley',
    'david_rist',
    'jonathan_spring',
    'chris_spring',
    'shawn_summers',
    'kyle_venancio',
    'michael_verteramo',
    'matthew_wrisley',
]

const only = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true as const]))

export const BALLOT_2026: AwardsMap = {
  ...STARTER_AWARDS,
  rookie_of_the_year: { ...STARTER_AWARDS.rookie_of_the_year, candidates: only(ROOKIES) },
  best_value_pick: { ...STARTER_AWARDS.best_value_pick, candidates: only(VALUE_PICKS) },
  best_ump: { ...STARTER_AWARDS.best_ump, candidates: only(UMPS) },
}
