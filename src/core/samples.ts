/**
 * サンプルの束（docs/SPEC.md §9.3）。
 *
 * 使い始めたあとでも足せるよう、種類ごとに分けて置く。
 * カレンダー設定は持たせない。追加のたびに利用者の営業日設定を
 * 上書きしてしまうのを避けるため。
 */

export type SamplePack = {
  id: string;
  name: string;
  description: string;
  file: string;
  count: number;
};

export function parseSampleIndex(input: unknown): SamplePack[] {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('サンプル一覧の形式が不正です');
  }
  const packs = (input as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) throw new TypeError('サンプル一覧に packs がありません');

  return packs.map((pack, index) => {
    if (typeof pack !== 'object' || pack === null) {
      throw new TypeError(`サンプル一覧の ${index} 番目が不正です`);
    }
    const candidate = pack as Partial<SamplePack>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.file !== 'string'
    ) {
      throw new TypeError(`サンプル "${String(candidate.id)}" の定義が不正です`);
    }
    return {
      id: candidate.id,
      name: candidate.name,
      description: candidate.description ?? '',
      file: candidate.file,
      count: candidate.count ?? 0,
    };
  });
}
