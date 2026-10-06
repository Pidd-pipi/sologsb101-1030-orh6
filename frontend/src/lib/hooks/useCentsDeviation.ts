/**
 * 派生某台琴的平均 / 最大音分偏差、音区分布与复调判定。
 * 被钢琴台账、调律记录页与提醒页消费。
 */
import { derived, type Readable } from 'svelte/store';
import type { TuningRow } from '$lib/utils/db';
import { centsFromStandardPitch, needsRepitch as needRepitchByCents, zoneDistribution, type ZoneDistribution } from '$lib/utils/cents';

/** 单台琴的音分偏差小结 */
export interface CentsSummary {
  /** 调律次数 */
  tuningCount: number;
  /** 最近一次调律的平均偏差 */
  avgDeviationCents: number;
  /** 最近一次调律的最大偏差 */
  maxDeviationCents: number;
  /** 最近调律日期 */
  lastTuningDate: string;
  /** 最近一次调律的基准音高与标准音的音分差 */
  pitchDropCents: number;
  /** 音区分布（无记录时为 null） */
  zones: ZoneDistribution | null;
  /** 是否需要二次复调 */
  needsRepitch: boolean;
}

/** 空小结：没有调律记录时使用 */
export const EMPTY_SUMMARY: CentsSummary = {
  tuningCount: 0,
  avgDeviationCents: 0,
  maxDeviationCents: 0,
  lastTuningDate: '—',
  pitchDropCents: 0,
  zones: null,
  needsRepitch: false
};

/** 纯函数版派生：按钢琴 id 汇总（页面逐行统计时直接调用） */
export function summarizeCents(tunings: TuningRow[], pianoId: string): CentsSummary {
  const own = tunings
    .filter((item) => item.pianoId === pianoId)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (own.length === 0) return { ...EMPTY_SUMMARY };
  const latest = own[0];
  return {
    tuningCount: own.length,
    avgDeviationCents: latest.avgDeviationCents,
    maxDeviationCents: latest.maxDeviationCents,
    lastTuningDate: latest.date,
    pitchDropCents: centsFromStandardPitch(latest.basePitchHz),
    zones: zoneDistribution(latest.zones),
    needsRepitch: latest.pitchRaised || needRepitchByCents(latest.avgDeviationCents, latest.maxDeviationCents)
  };
}

/**
 * Store 版派生：`pianoId` 变化时自动重新汇总。
 * @param tunings 全量调律记录
 * @param pianoId 当前选中的钢琴 id
 */
export function useCentsDeviation(
  tunings: Readable<TuningRow[]>,
  pianoId: Readable<string | null>
): Readable<CentsSummary> {
  return derived([tunings, pianoId], ([$tunings, $pianoId]) =>
    $pianoId ? summarizeCents($tunings, $pianoId) : { ...EMPTY_SUMMARY }
  );
}
