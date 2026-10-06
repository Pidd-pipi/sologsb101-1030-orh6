/** 监测方式 */
export type EnvDevice = '温湿度计' | '记录仪';

/** 琴房环境记录 */
export interface Environment {
  id: string;
  /** 所属钢琴 */
  pianoId: string;
  /** 日期 */
  date: string;
  /** 温度 ℃ */
  tempC: number;
  /** 相对湿度 % */
  humidityPct: number;
  /** 监测方式 */
  device: EnvDevice;
  /** 是否超标 */
  abnormal: boolean;
}

/** 建议温度区间 ℃ */
export const TEMP_RANGE: [number, number] = [18, 26];
/** 建议湿度区间 % */
export const HUMIDITY_RANGE: [number, number] = [40, 60];

export const ENV_DEVICES: EnvDevice[] = ['温湿度计', '记录仪'];

/** 温度和湿度是否超出建议区间 */
export function isAbnormal(tempC: number, humidityPct: number): boolean {
  return (
    tempC < TEMP_RANGE[0] ||
    tempC > TEMP_RANGE[1] ||
    humidityPct < HUMIDITY_RANGE[0] ||
    humidityPct > HUMIDITY_RANGE[1]
  );
}

/** 超标项的文字提示 */
export function abnormalHint(tempC: number, humidityPct: number): string {
  const hints: string[] = [];
  if (tempC < TEMP_RANGE[0]) hints.push('温度偏低，建议升温');
  if (tempC > TEMP_RANGE[1]) hints.push('温度偏高，建议通风降温');
  if (humidityPct < HUMIDITY_RANGE[0]) hints.push('湿度偏低，建议加湿');
  if (humidityPct > HUMIDITY_RANGE[1]) hints.push('湿度偏高，建议除湿');
  return hints.join('；') || '处于建议区间';
}

export function createEmptyEnvironment(): Omit<Environment, 'id'> {
  return {
    pianoId: '',
    date: new Date().toISOString().slice(0, 10),
    tempC: 22,
    humidityPct: 50,
    device: '温湿度计',
    abnormal: false
  };
}
