import { describe, expect, it } from 'vitest'

import type { GitGraphCommit } from '~/lib/types'

import { computeGraphLayout } from './graph-layout'

function commit(sha: string, parents: string[] = []): GitGraphCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    refs: [],
    subject: `Commit ${sha}`,
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    gravatarHash: '',
    date: '2026-05-19T00:00:00.000Z',
    timestamp: 1_779_120_000_000,
  }
}

describe('computeGraphLayout', () => {
  it('keeps a linear history in a single lane', () => {
    const layout = computeGraphLayout([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1'),
    ])

    expect(layout.map(item => item.lane)).toEqual([0, 0, 0])
    expect(layout.map(item => item.totalLanes)).toEqual([1, 1, 1])
    expect(layout.map(item => item.visibleLaneCount)).toEqual([1, 1, 1])
    expect(layout[0].linesAbove).toEqual([])
    expect(layout[0].linesBelow).toEqual([{ fromLane: 0, toLane: 0 }])
    expect(layout[1].linesAbove).toEqual([{ fromLane: 0, toLane: 0 }])
    expect(layout[1].linesBelow).toEqual([{ fromLane: 0, toLane: 0 }])
    expect(layout[2].linesAbove).toEqual([{ fromLane: 0, toLane: 0 }])
    expect(layout[2].linesBelow).toEqual([])
  })

  it('splits merge parents into stable lanes and converges them back', () => {
    const layout = computeGraphLayout([
      commit('merge', ['main-parent', 'feature-parent']),
      commit('main-parent', ['base']),
      commit('feature-parent', ['base']),
      commit('base'),
    ])

    expect(layout.map(item => ({
      sha: item.sha,
      lane: item.lane,
      totalLanes: item.totalLanes,
      visibleLaneCount: item.visibleLaneCount,
    }))).toEqual([
      { sha: 'merge', lane: 0, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'main-parent', lane: 0, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'feature-parent', lane: 1, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'base', lane: 0, totalLanes: 2, visibleLaneCount: 1 },
    ])

    expect(layout[0].linesBelow).toEqual([
      { fromLane: 0, toLane: 0 },
      { fromLane: 0, toLane: 1 },
    ])
    expect(layout[1].linesAbove).toEqual([
      { fromLane: 0, toLane: 0 },
      { fromLane: 1, toLane: 1 },
    ])
    expect(layout[1].linesBelow).toEqual([
      { fromLane: 0, toLane: 0 },
      { fromLane: 1, toLane: 1 },
    ])
    expect(layout[2].linesAbove).toEqual([
      { fromLane: 0, toLane: 0 },
      { fromLane: 1, toLane: 1 },
    ])
    expect(layout[2].linesBelow).toEqual([{ fromLane: 1, toLane: 0 }])
    expect(layout[3].linesAbove).toEqual([{ fromLane: 0, toLane: 0 }])
  })

  it('keeps mainline-only rows compact after a side branch ends', () => {
    const layout = computeGraphLayout([
      commit('tip', ['after-merge']),
      commit('after-merge', ['merge']),
      commit('merge', ['main-parent', 'feature-parent']),
      commit('main-parent', ['base']),
      commit('feature-parent', ['base']),
      commit('base'),
    ])

    expect(layout.map(item => ({
      sha: item.sha,
      lane: item.lane,
      totalLanes: item.totalLanes,
      visibleLaneCount: item.visibleLaneCount,
    }))).toEqual([
      { sha: 'tip', lane: 0, totalLanes: 2, visibleLaneCount: 1 },
      { sha: 'after-merge', lane: 0, totalLanes: 2, visibleLaneCount: 1 },
      { sha: 'merge', lane: 0, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'main-parent', lane: 0, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'feature-parent', lane: 1, totalLanes: 2, visibleLaneCount: 2 },
      { sha: 'base', lane: 0, totalLanes: 2, visibleLaneCount: 1 },
    ])
  })

  it('returns an empty layout for an empty graph', () => {
    expect(computeGraphLayout([])).toEqual([])
  })
})
