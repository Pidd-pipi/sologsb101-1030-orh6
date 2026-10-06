/**
 * 音分与频率换算、十二平均律基准音高比对、偏差分档与配色映射
 * 被钢琴台账、调律记录页与提醒页共同消费。
 */
import { STANDARD_PITCH_HZ } from '$lib/types/tuning';

/** 十二平均律半音数 → 频率比 */
const SEMITONE_RATIO = Math.pow(2, 1 / 12);

/** 两个频率之间的音分差：1200 * log2(f / f0) */
export function centsBetween(freq: number, reference: number): number {
  if (freq <= 0 || reference <= 0) return 0;
  return Number((1200 * Math.log2(freq / reference)).toFixed(2));
}

/** 由基准频率与音分偏差反算实际频率 */
export function freqFromCents(reference: number, cents: number): number {
  return Number((reference * Math.pow(2, cents / 1200)).toFixed(3));
}

/** 与标准音 A4 = 440 Hz 的音分偏差 */
export function centsFromStandardPitch(pitchHz: number): number {
  return centsBetween(pitchHz, STANDARD_PITCH_HZ);
}

/** 平均律半音频率（keyIndex 为相对 A4 的半音数） */
export function equalTemperamentFreq(keyIndex: number): number {
  return Number((STANDARD_PITCH_HZ * Math.pow(SEMITONE_RATIO, keyIndex)).toFixed(3));
}

/** 偏差分档 */
export type CentsBand = '±5' | '±10' | '±20' | '±20以上';

/** 按绝对值分档：≤5 / ≤10 / ≤20 / >20 */
export function centsBand(cents: number): CentsBand {
  const abs = Math.abs(cents);
  if (abs <= 5) return '±5';
  if (abs <= 10) return '±10';
  if (abs <= 20) return '±20';
  return '±20以上';
}

/** 分档 → Tailwind 类名（底色与文字色） */
export function bandClass(cents: number): string {
  switch (centsBand(cents)) {
    case '±5':
      return 'bg-emerald-100 text-emerald-800 ring-emerald-300';
    case '±10':
      return 'bg-lime-100 text-lime-800 ring-lime-300';
    case '±20':
      return 'bg-amber-100 text-amber-800 ring-amber-300';
    default:
      return 'bg-rose-100 text-rose-800 ring-rose-300';
  }
}

/** 分档 → 十六进制色（用于自绘条形图） */
export function bandColor(cents: number): string {
  switch (centsBand(cents)) {
    case '±5':
      return '#0f9d63';
    case '±10':
      return '#65a30d';
    case '±20':
      return '#d97706';
    default:
      return '#dc2626';
  }
}

/** 分档 → 图标字符 */
export function bandIcon(cents: number): string {
  switch (centsBand(cents)) {
    case '±5':
      return '✓';
    case '±10':
      return '≈';
    case '±20':
      return '!';
    default:
      return '‼';
  }
}

/** 带正负号的音分文本 */
export function formatCents(cents: number): string {
  const value = Number(cents.toFixed(1));
  return `${value > 0 ? '+' : ''}${value} 音分`;
}

/** 判断是否需要二次复调 */
export function needsRepitch(avgDeviationCents: number, maxDeviationCents: number): boolean {
  return Math.abs(avgDeviationCents) > 8 || Math.abs(maxDeviationCents) > 20;
}

/** 音区偏差分布（低 / 中 / 高） */
export interface ZoneDistribution {
  bass: number;
  mid: number;
  treble: number;
  /** 偏差最大的音区 */
  worst: '低音区' | '中音区' | '高音区';
}

/** 由各音区偏差得出分布与最差音区 */
export function zoneDistribution(zones: { bass: number; mid: number; treble: number }): ZoneDistribution {
  const entries: Array<[ZoneDistribution['worst'], number]> = [
    ['低音区', Math.abs(zones.bass)],
    ['中音区', Math.abs(zones.mid)],
    ['高音区', Math.abs(zones.treble)]
  ];
  const worst = entries.reduce((acc, item) => (item[1] > acc[1] ? item : acc), entries[0])[0];
  return { bass: zones.bass, mid: zones.mid, treble: zones.treble, worst };
}

/** 条形图高度百分比：以 40 音分为满格 */
export function barHeight(cents: number): number {
  return Math.max(4, Math.min(100, Math.round((Math.abs(cents) / 40) * 100)));
}
