/**
 * 钢琴档案 JSON 序列化与校验
 * 提醒页用于导出单琴档案，并校验导入内容。
 * 单琴档案导出的是业务字段 + 修订号/来源，方便人工核对；整库备份见 utils/db.ts。
 */
import type { Piano } from '$lib/types/piano';
import type { Tuning } from '$lib/types/tuning';
import type { Voicing } from '$lib/types/voicing';
import type { Environment } from '$lib/types/environment';
import type { Reminder } from '$lib/types/reminder';
import { DB_NAME, DB_SCHEMA_VERSION, db, listEnvironments, listTunings, listVoicings } from './db';
import { nowIso } from './uuid';
import { zoneDistribution } from './cents';

/** 单台钢琴档案（行保留修订号 / 来源，便于归档核对） */
export interface PianoArchive {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  piano: Piano;
  tunings: Tuning[];
  voicings: Voicing[];
  environments: Environment[];
  reminder: Reminder | null;
  summary: {
    tuningCount: number;
    avgDeviationCents: number;
    maxDeviationCents: number;
    worstZone: string;
    maintenanceCount: number;
    abnormalDays: number;
    lastTuningDate: string;
    nextDueDate: string;
  };
}

/** 归档时去掉内部索引字段（保留 revision / source，供人工追溯） */
function toArchiveRow<T>(row: T): T {
  const copy = { ...(row as object) } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.lastClientId;
  return copy as T;
}

/** 汇总某台琴的完整档案 */
export async function buildPianoArchive(pianoId: string): Promise<PianoArchive> {
  const piano = await db.pianos.get(pianoId);
  if (!piano) throw new Error('钢琴档案不存在');
  const [allTunings, allVoicings, allEnvironments, reminder] = await Promise.all([
    listTunings(),
    listVoicings(),
    listEnvironments(),
    db.reminders.where('pianoId').equals(pianoId).first()
  ]);
  const tunings = allTunings.filter((item) => item.pianoId === pianoId);
  const voicings = allVoicings.filter((item) => item.pianoId === pianoId);
  const environments = allEnvironments.filter((item) => item.pianoId === pianoId);
  const latest = tunings[0];
  const worstZone = latest ? zoneDistribution(latest.zones).worst : '—';

  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    piano: toArchiveRow(piano) as unknown as Piano,
    tunings: tunings.map(toArchiveRow) as unknown as Tuning[],
    voicings: voicings.map(toArchiveRow) as unknown as Voicing[],
    environments: environments.map(toArchiveRow) as unknown as Environment[],
    reminder: reminder ? (toArchiveRow(reminder) as unknown as Reminder) : null,
    summary: {
      tuningCount: tunings.length,
      avgDeviationCents: latest ? latest.avgDeviationCents : 0,
      maxDeviationCents: latest ? latest.maxDeviationCents : 0,
      worstZone,
      maintenanceCount: voicings.length,
      abnormalDays: environments.filter((item) => item.abnormal).length,
      lastTuningDate: latest ? latest.date : '—',
      nextDueDate: reminder ? reminder.nextDueDate : '—'
    }
  };
}

export function serializeArchive(archive: PianoArchive): string {
  return JSON.stringify(archive, null, 2);
}

/** 校验并解析档案 / 备份 JSON，失败时抛出可读错误 */
export function parseArchive(text: string): PianoArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文本');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('档案根节点必须是对象');
  }
  const candidate = parsed as Partial<PianoArchive>;
  if (typeof candidate.name !== 'string') throw new Error('缺少 name 字段');
  if (typeof candidate.schemaVersion !== 'number') throw new Error('缺少 schemaVersion 字段');
  if (!candidate.piano || typeof (candidate.piano as { id?: unknown }).id !== 'string') {
    throw new Error('缺少 piano.id 字段');
  }
  if (!Array.isArray(candidate.tunings)) throw new Error('tunings 必须是数组');
  return candidate as PianoArchive;
}

/** 触发浏览器下载（纯前端，无需后端） */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
