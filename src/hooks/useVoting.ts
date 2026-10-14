import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import type { AwardsMap, Voter, VotingExcluded, VotingMeta, VotingState } from '../types'

const EMPTY: VotingState = { meta: { open: false }, awards: {}, voters: {}, ballots: {}, excluded: {} }

/** /voting listener — the whole tree, for the admin screen. */
export function useVoting() {
  const [voting, setVoting] = useState<VotingState>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onValue(ref(db, 'voting'), snap => {
      const v = (snap.val() ?? {}) as Partial<VotingState>
      setVoting({
        meta: { ...EMPTY.meta, ...v.meta },
        awards: v.awards ?? {},
        voters: v.voters ?? {},
        ballots: v.ballots ?? {},
        excluded: v.excluded ?? {},
      })
      setLoading(false)
    })
    return unsub
  }, [])

  return { voting, loading }
}

/** The ballot page's view: poll status, the awards, the exclusion list, and
 *  this link's own voter record. Deliberately never reads /voting/voters or
 *  /voting/ballots as a whole, so it keeps working once those paths stop
 *  being publicly readable. */
export function useBallotSetup(token: string | undefined) {
  const [meta, setMeta] = useState<VotingMeta | null>(null)
  const [awards, setAwards] = useState<AwardsMap | null>(null)
  const [excluded, setExcluded] = useState<VotingExcluded | null>(null)
  const [voter, setVoter] = useState<Voter | null | undefined>(undefined)
  // Keys can't contain . # $ [ ] / — a mangled link is just "not found".
  const validToken = !!token && !/[.#$[\]/]/.test(token)

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, 'voting/meta'), snap => setMeta({ open: false, ...(snap.val() ?? {}) })),
      onValue(ref(db, 'voting/awards'), snap => setAwards((snap.val() ?? {}) as AwardsMap)),
      onValue(ref(db, 'voting/excluded'), snap => setExcluded((snap.val() ?? {}) as VotingExcluded)),
    ]
    if (validToken) {
      unsubs.push(onValue(
        ref(db, `voting/voters/${token}`),
        snap => setVoter(snap.exists() ? (snap.val() as Voter) : null),
        () => setVoter(null),
      ))
    }
    return () => unsubs.forEach(u => u())
  }, [token, validToken])

  const voterOut = validToken ? voter : null
  const loading = meta === null || awards === null || excluded === null || voterOut === undefined
  return { meta, awards, excluded: excluded ?? {}, voter: voterOut, loading }
}
